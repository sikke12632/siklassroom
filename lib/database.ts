import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  NEIS_API_KEY?: string;
  SYSTEM_ADMIN_USERNAME?: string;
  SYSTEM_ADMIN_PASSWORD_HASH?: string;
  SYSTEM_ADMIN_PATH?: string;
};

let schemaReady: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', email_verified_at INTEGER,
    teacher_access_status TEXT NOT NULL DEFAULT 'pending', teacher_access_verified_at INTEGER,
    school_id TEXT, manual_school_request_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, school_name TEXT NOT NULL,
    school_normalized TEXT NOT NULL, school_id TEXT, manual_school_request_id TEXT,
    school_year INTEGER NOT NULL, grade INTEGER NOT NULL,
    class_number INTEGER NOT NULL, display_name TEXT, status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS classes_identity_uq ON classes(school_normalized, school_year, grade, class_number)`,
  `CREATE INDEX IF NOT EXISTS classes_teacher_idx ON classes(teacher_id)`,
  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, student_number INTEGER NOT NULL,
    official_name TEXT NOT NULL, password_hash TEXT, status TEXT NOT NULL DEFAULT 'pending',
    qr_generation INTEGER NOT NULL DEFAULT 0, activated_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS students_class_number_uq ON students(class_id, student_number)`,
  `CREATE INDEX IF NOT EXISTS students_class_idx ON students(class_id)`,
  `CREATE TABLE IF NOT EXISTS registration_tokens (
    id TEXT PRIMARY KEY, student_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL, generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    used_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(id)
  )`,
  `CREATE INDEX IF NOT EXISTS registration_tokens_student_idx ON registration_tokens(student_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, actor_type TEXT NOT NULL,
    teacher_id TEXT, student_id TEXT, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_teacher_idx ON sessions(teacher_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_student_idx ON sessions(student_id)`,
  `CREATE TABLE IF NOT EXISTS teacher_password_resets (
    id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`,
  `CREATE INDEX IF NOT EXISTS teacher_password_resets_teacher_idx ON teacher_password_resets(teacher_id)`,
  `CREATE TABLE IF NOT EXISTS login_throttles (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at INTEGER NOT NULL, blocked_until INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, teacher_id TEXT, class_id TEXT, student_id TEXT,
    action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_logs_teacher_idx ON audit_logs(teacher_id)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_class_idx ON audit_logs(class_id)`,
  `CREATE TABLE IF NOT EXISTS job_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, short_description TEXT NOT NULL,
    detailed_tasks TEXT NOT NULL, category TEXT NOT NULL,
    recommended_min_members INTEGER NOT NULL, recommended_max_members INTEGER NOT NULL,
    icon_key TEXT NOT NULL, default_priority INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS job_templates_category_idx ON job_templates(category)`,
  `CREATE TABLE IF NOT EXISTS class_job_setup (
    class_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'not_started',
    setup_mode TEXT, survey_answers TEXT, draft_jobs TEXT,
    student_count_snapshot INTEGER NOT NULL DEFAULT 0,
    selected_job_count INTEGER NOT NULL DEFAULT 0,
    selected_capacity INTEGER NOT NULL DEFAULT 0,
    last_step INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS class_jobs (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, template_id TEXT,
    name TEXT NOT NULL, description TEXT NOT NULL, member_capacity INTEGER NOT NULL,
    category TEXT NOT NULL, source TEXT NOT NULL, sort_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (template_id) REFERENCES job_templates(id)
  )`,
  `CREATE INDEX IF NOT EXISTS class_jobs_class_idx ON class_jobs(class_id)`,
  `CREATE INDEX IF NOT EXISTS class_jobs_template_idx ON class_jobs(template_id)`,
  `CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY, office_code TEXT NOT NULL, school_code TEXT NOT NULL,
    official_name TEXT NOT NULL, normalized_name TEXT NOT NULL, search_name TEXT NOT NULL,
    school_level TEXT NOT NULL, province_name TEXT NOT NULL, district_name TEXT,
    road_address TEXT, status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'neis',
    source_updated_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS schools_office_school_uq ON schools(office_code, school_code)`,
  `CREATE INDEX IF NOT EXISTS schools_normalized_idx ON schools(normalized_name)`,
  `CREATE INDEX IF NOT EXISTS schools_search_idx ON schools(search_name)`,
  `CREATE INDEX IF NOT EXISTS schools_filters_idx ON schools(province_name, school_level, status)`,
  `CREATE TABLE IF NOT EXISTS school_aliases (
    id TEXT PRIMARY KEY, school_id TEXT NOT NULL, alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL, alias_type TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS school_aliases_school_normalized_uq ON school_aliases(school_id, normalized_alias)`,
  `CREATE INDEX IF NOT EXISTS school_aliases_normalized_idx ON school_aliases(normalized_alias)`,
  `CREATE TABLE IF NOT EXISTS school_manual_requests (
    id TEXT PRIMARY KEY, submitted_by_teacher_id TEXT NOT NULL,
    entered_name TEXT NOT NULL, normalized_name TEXT NOT NULL, province_name TEXT NOT NULL,
    school_level TEXT NOT NULL, district_or_address TEXT, note TEXT,
    status TEXT NOT NULL DEFAULT 'pending', linked_school_id TEXT,
    created_at INTEGER NOT NULL, reviewed_at INTEGER,
    FOREIGN KEY (submitted_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (linked_school_id) REFERENCES schools(id)
  )`,
  `CREATE INDEX IF NOT EXISTS school_manual_requests_teacher_idx ON school_manual_requests(submitted_by_teacher_id)`,
  `CREATE INDEX IF NOT EXISTS school_manual_requests_lookup_idx ON school_manual_requests(normalized_name, province_name, status)`,
  `CREATE TABLE IF NOT EXISTS teacher_email_verifications (
    id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL, used_at INTEGER, invalidated_at INTEGER, created_at INTEGER NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`,
  `CREATE INDEX IF NOT EXISTS teacher_email_verifications_teacher_idx ON teacher_email_verifications(teacher_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS teacher_invite_codes (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
    issued_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
    used_by_teacher_id TEXT, revoked_at INTEGER, created_at INTEGER NOT NULL,
    FOREIGN KEY (used_by_teacher_id) REFERENCES teachers(id)
  )`,
  `CREATE INDEX IF NOT EXISTS teacher_invite_codes_status_idx ON teacher_invite_codes(status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS system_migrations (
    key TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS teacher_email_verified_after_token_use
    AFTER UPDATE OF used_at ON teacher_email_verifications
    WHEN NEW.used_at IS NOT NULL AND OLD.used_at IS NULL
    BEGIN
      UPDATE teachers SET email_verified_at = COALESCE(email_verified_at, NEW.used_at),
        updated_at = NEW.used_at WHERE id = NEW.teacher_id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS teacher_access_after_invite_use
    AFTER UPDATE OF status ON teacher_invite_codes
    WHEN NEW.status = 'used' AND OLD.status = 'active' AND NEW.used_by_teacher_id IS NOT NULL
    BEGIN
      UPDATE teachers SET teacher_access_status = 'invite_verified',
        teacher_access_verified_at = NEW.used_at, updated_at = NEW.used_at
      WHERE id = NEW.used_by_teacher_id;
    END`,
];

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function database(): D1Database {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("데이터 저장소가 아직 연결되지 않았습니다.");
  return db;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = database();
      await db.batch([
        db.prepare(schemaStatements[0]),
        db.prepare(schemaStatements[1]),
      ]);
      await ensureColumn(db, "teachers", "email_verified_at", "INTEGER");
      await ensureColumn(db, "teachers", "teacher_access_status", "TEXT NOT NULL DEFAULT 'pending'");
      await ensureColumn(db, "teachers", "teacher_access_verified_at", "INTEGER");
      await ensureColumn(db, "teachers", "school_id", "TEXT");
      await ensureColumn(db, "teachers", "manual_school_request_id", "TEXT");
      await ensureColumn(db, "classes", "school_id", "TEXT");
      await ensureColumn(db, "classes", "manual_school_request_id", "TEXT");
      const statements = schemaStatements.map((sql) => db.prepare(sql));
      await db.batch(statements);
      await bootstrapExistingTeachers(db);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function ensureColumn(db: D1Database, table: "teachers" | "classes", column: string, definition: string) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (info.results.some((item) => item.name === column)) return;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function bootstrapExistingTeachers(db: D1Database) {
  const key = "2026-07-teacher-access-bootstrap";
  const applied = await db.prepare(`SELECT key FROM system_migrations WHERE key = ?`).bind(key).first();
  if (applied) return;
  const now = Date.now();
  await db.batch([
    db.prepare(
      `UPDATE teachers
       SET email_verified_at = COALESCE(email_verified_at, updated_at, created_at),
           teacher_access_status = 'invite_verified',
           teacher_access_verified_at = COALESCE(teacher_access_verified_at, updated_at, created_at)
       WHERE email_verified_at IS NULL OR teacher_access_status = 'pending'`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO school_manual_requests
       (id, submitted_by_teacher_id, entered_name, normalized_name, province_name, school_level,
        district_or_address, note, status, created_at)
       SELECT 'legacy-' || t.id, t.id, c.school_name, c.school_normalized, '미지정', '초등학교',
              NULL, '기존 학급에서 안전하게 이관한 학교', 'pending', t.created_at
       FROM teachers t
       JOIN classes c ON c.id = (
         SELECT c2.id FROM classes c2 WHERE c2.teacher_id = t.id ORDER BY c2.created_at ASC LIMIT 1
       )
       WHERE t.school_id IS NULL AND t.manual_school_request_id IS NULL`,
    ),
    db.prepare(
      `UPDATE teachers SET manual_school_request_id = 'legacy-' || id
       WHERE school_id IS NULL AND manual_school_request_id IS NULL
         AND EXISTS (
           SELECT 1 FROM school_manual_requests r WHERE r.id = 'legacy-' || teachers.id
         )`,
    ),
    db.prepare(
      `UPDATE classes
       SET manual_school_request_id = (
         SELECT t.manual_school_request_id FROM teachers t WHERE t.id = classes.teacher_id
       )
       WHERE school_id IS NULL AND manual_school_request_id IS NULL`,
    ),
    db.prepare(`INSERT INTO system_migrations (key, applied_at) VALUES (?, ?)`).bind(key, now),
  ]);
}

export async function audit(input: {
  action: string;
  teacherId?: string | null;
  classId?: string | null;
  studentId?: string | null;
  detail?: Record<string, unknown> | string | null;
}) {
  await ensureSchema();
  const detail = typeof input.detail === "string" ? input.detail : input.detail ? JSON.stringify(input.detail) : null;
  await database().prepare(
    `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.teacherId ?? null, input.classId ?? null,
    input.studentId ?? null, input.action, detail, Date.now(),
  ).run();
}

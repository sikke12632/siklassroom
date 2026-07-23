import { env } from "cloudflare:workers";

type RuntimeEnv = { DB?: D1Database; RESEND_API_KEY?: string; MAIL_FROM?: string };

let schemaReady: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, school_name TEXT NOT NULL,
    school_normalized TEXT NOT NULL, school_year INTEGER NOT NULL, grade INTEGER NOT NULL,
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
      const statements = schemaStatements.map((sql) => db.prepare(sql));
      await db.batch(statements);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
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

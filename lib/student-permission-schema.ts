export const STUDENT_PERMISSION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS student_manual_permissions (
    id TEXT PRIMARY KEY NOT NULL,
    class_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    granted_by_teacher_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (granted_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT student_manual_permissions_key_ck CHECK (
      permission_key IN (
        'finance_banker', 'mart_operator',
        'life_check_tooth', 'life_check_milk', 'life_check_lunch'
      )
    ),
    CONSTRAINT student_manual_permissions_active_ck CHECK (is_active IN (0, 1)),
    CONSTRAINT student_manual_permissions_revision_ck CHECK (revision >= 1)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS student_manual_permissions_scope_uq
    ON student_manual_permissions(class_id, student_id, permission_key)`,
  `CREATE INDEX IF NOT EXISTS student_manual_permissions_student_idx
    ON student_manual_permissions(student_id, is_active)`,
  `CREATE INDEX IF NOT EXISTS student_manual_permissions_class_active_idx
    ON student_manual_permissions(class_id, permission_key, is_active)`,
  `CREATE TRIGGER IF NOT EXISTS student_manual_permissions_insert_guard
    BEFORE INSERT ON student_manual_permissions
    WHEN NEW.is_active <> 1
      OR NEW.revision <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM students student
        JOIN classes classroom ON classroom.id = student.class_id
        WHERE student.id = NEW.student_id
          AND student.class_id = NEW.class_id
          AND student.status = 'active'
          AND classroom.status = 'active'
          AND classroom.teacher_id = NEW.granted_by_teacher_id
      )
    BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_CONTEXT_INVALID'); END`,
  `CREATE TRIGGER IF NOT EXISTS student_manual_permissions_update_guard
    BEFORE UPDATE ON student_manual_permissions
    WHEN NEW.id <> OLD.id
      OR NEW.class_id <> OLD.class_id
      OR NEW.student_id <> OLD.student_id
      OR NEW.permission_key <> OLD.permission_key
      OR NEW.created_at <> OLD.created_at
      OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at < OLD.updated_at
      OR NEW.is_active = OLD.is_active
      OR NOT EXISTS (
        SELECT 1
        FROM students student
        JOIN classes classroom ON classroom.id = student.class_id
        WHERE student.id = NEW.student_id
          AND student.class_id = NEW.class_id
          AND classroom.status = 'active'
          AND classroom.teacher_id = NEW.granted_by_teacher_id
          AND (NEW.is_active = 0 OR student.status = 'active')
      )
    BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_STALE_OR_DENIED'); END`,
  `CREATE TRIGGER IF NOT EXISTS student_manual_permissions_delete_guard
    BEFORE DELETE ON student_manual_permissions
    BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_DELETE_FORBIDDEN'); END`,
  `CREATE TRIGGER IF NOT EXISTS class_permission_period_update_guard
    BEFORE UPDATE ON class_job_assignment_periods
    WHEN OLD.assignment_type = 'permission'
    BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_PERIOD_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS class_permission_period_delete_guard
    BEFORE DELETE ON class_job_assignment_periods
    WHEN OLD.assignment_type = 'permission'
    BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_PERIOD_IMMUTABLE'); END`,
  `DROP VIEW IF EXISTS student_effective_permissions`,
  `CREATE VIEW student_effective_permissions AS
    SELECT manual.class_id,
           manual.student_id,
           manual.permission_key,
           COALESCE((
             SELECT period.id
             FROM class_job_assignment_periods period
             WHERE period.class_id = manual.class_id
               AND period.status = 'confirmed'
               AND period.assignment_type IN ('initial', 'monthly')
               AND (
                 period.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
                 OR (
                   period.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
                   AND period.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
                 )
               )
             ORDER BY period.assignment_year DESC, period.assignment_month DESC,
                      COALESCE(period.confirmed_at, 0) DESC,
                      period.updated_at DESC, period.id DESC
             LIMIT 1
           ), (
             SELECT period.id
             FROM class_job_assignment_periods period
             WHERE period.class_id = manual.class_id
               AND period.assignment_type = 'permission'
             ORDER BY period.created_at, period.id
             LIMIT 1
           )) AS period_id,
           'manual' AS permission_source
    FROM student_manual_permissions manual
    JOIN students student
      ON student.id = manual.student_id
     AND student.class_id = manual.class_id
    JOIN classes classroom ON classroom.id = manual.class_id
    WHERE manual.is_active = 1
      AND student.status = 'active'
      AND classroom.status = 'active'
    UNION ALL
    SELECT assignment.class_id,
           assignment.student_id,
           CASE job.template_id
             WHEN 'banker' THEN 'finance_banker'
             WHEN 'market-clerk' THEN 'mart_operator'
             WHEN 'routine-checker' THEN 'life_check_tooth'
             WHEN 'milk-manager' THEN 'life_check_milk'
             WHEN 'meal-checker' THEN 'life_check_lunch'
           END AS permission_key,
           period.id AS period_id,
           'automatic' AS permission_source
    FROM student_job_assignments assignment
    JOIN class_job_assignment_periods period
      ON period.id = assignment.period_id
     AND period.class_id = assignment.class_id
    JOIN class_jobs job
      ON job.id = assignment.class_job_id
     AND job.class_id = assignment.class_id
    JOIN students student
      ON student.id = assignment.student_id
     AND student.class_id = assignment.class_id
    JOIN classes classroom ON classroom.id = assignment.class_id
    WHERE period.status = 'confirmed'
      AND period.assignment_type IN ('initial', 'monthly')
      AND job.is_active = 1
      AND job.template_id IN (
        'banker', 'market-clerk', 'routine-checker', 'milk-manager', 'meal-checker'
      )
      AND student.status = 'active'
      AND classroom.status = 'active'
      AND (
        period.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
        OR (
          period.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
          AND period.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM class_job_assignment_periods newer
        WHERE newer.class_id = period.class_id
          AND newer.status = 'confirmed'
          AND newer.assignment_type IN ('initial', 'monthly')
          AND (
            newer.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
            OR (
              newer.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
              AND newer.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
            )
          )
          AND (
            newer.assignment_year > period.assignment_year
            OR (
              newer.assignment_year = period.assignment_year
              AND newer.assignment_month > period.assignment_month
            )
            OR (
              newer.assignment_year = period.assignment_year
              AND newer.assignment_month = period.assignment_month
              AND COALESCE(newer.confirmed_at, 0) > COALESCE(period.confirmed_at, 0)
            )
            OR (
              newer.assignment_year = period.assignment_year
              AND newer.assignment_month = period.assignment_month
              AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
              AND newer.updated_at > period.updated_at
            )
            OR (
              newer.assignment_year = period.assignment_year
              AND newer.assignment_month = period.assignment_month
              AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
              AND newer.updated_at = period.updated_at
              AND newer.id > period.id
            )
          )
      )`,
] as const;

export const LIFE_CHECK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS life_check_series (
    class_id TEXT NOT NULL,
    check_type TEXT NOT NULL CHECK (check_type IN ('tooth', 'milk', 'lunch')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (class_id, check_type),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS life_check_series_update_guard
    BEFORE UPDATE ON life_check_series
    WHEN NEW.class_id <> OLD.class_id
      OR NEW.check_type <> OLD.check_type
      OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at < OLD.updated_at
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_SERIES_STALE'); END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_series_delete_guard
    BEFORE DELETE ON life_check_series
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_SERIES_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS life_check_records (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    check_type TEXT NOT NULL CHECK (check_type IN ('tooth', 'milk', 'lunch')),
    check_date TEXT NOT NULL,
    student_id TEXT NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    last_actor_type TEXT NOT NULL CHECK (last_actor_type IN ('teacher', 'checker')),
    last_actor_teacher_id TEXT,
    last_actor_student_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (last_actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (last_actor_student_id) REFERENCES students(id),
    UNIQUE (class_id, check_type, check_date, student_id),
    CHECK (
      (last_actor_type = 'teacher' AND last_actor_teacher_id IS NOT NULL AND last_actor_student_id IS NULL)
      OR (last_actor_type = 'checker' AND last_actor_teacher_id IS NULL AND last_actor_student_id IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS life_check_records_scope_idx
    ON life_check_records(class_id, check_type, check_date, student_id)`,
  `DROP TRIGGER IF EXISTS life_check_records_insert_guard`,
  `CREATE TRIGGER IF NOT EXISTS life_check_records_insert_guard
    BEFORE INSERT ON life_check_records
    WHEN NOT EXISTS (
      SELECT 1
      FROM students target
      JOIN classes classroom ON classroom.id = target.class_id
      WHERE target.id = NEW.student_id
        AND target.class_id = NEW.class_id
        AND target.status <> 'excluded'
        AND classroom.status = 'active'
        AND (
          (NEW.last_actor_type = 'teacher'
            AND classroom.teacher_id = NEW.last_actor_teacher_id)
          OR (NEW.last_actor_type = 'checker' AND EXISTS (
            SELECT 1
            FROM student_effective_permissions permission
            WHERE permission.student_id = NEW.last_actor_student_id
              AND permission.class_id = NEW.class_id
              AND permission.permission_key = CASE NEW.check_type
                WHEN 'tooth' THEN 'life_check_tooth'
                WHEN 'milk' THEN 'life_check_milk'
                WHEN 'lunch' THEN 'life_check_lunch'
              END
          ))
        )
    )
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_RECORD_SCOPE_DENIED'); END`,
  `DROP TRIGGER IF EXISTS life_check_records_update_guard`,
  `CREATE TRIGGER IF NOT EXISTS life_check_records_update_guard
    BEFORE UPDATE ON life_check_records
    WHEN NEW.id <> OLD.id
      OR NEW.class_id <> OLD.class_id
      OR NEW.check_type <> OLD.check_type
      OR NEW.check_date <> OLD.check_date
      OR NEW.student_id <> OLD.student_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at < OLD.updated_at
      OR NOT EXISTS (
        SELECT 1
        FROM students target
        JOIN classes classroom ON classroom.id = target.class_id
        WHERE target.id = NEW.student_id
          AND target.class_id = NEW.class_id
          AND target.status <> 'excluded'
          AND classroom.status = 'active'
          AND (
            (NEW.last_actor_type = 'teacher'
              AND classroom.teacher_id = NEW.last_actor_teacher_id)
            OR (NEW.last_actor_type = 'checker' AND EXISTS (
              SELECT 1
              FROM student_effective_permissions permission
              WHERE permission.student_id = NEW.last_actor_student_id
                AND permission.class_id = NEW.class_id
                AND permission.permission_key = CASE NEW.check_type
                  WHEN 'tooth' THEN 'life_check_tooth'
                  WHEN 'milk' THEN 'life_check_milk'
                  WHEN 'lunch' THEN 'life_check_lunch'
                END
            ))
          )
      )
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_RECORD_STALE_OR_DENIED'); END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_records_delete_guard
    BEFORE DELETE ON life_check_records
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_RECORD_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS life_check_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL CHECK (LENGTH(request_id) BETWEEN 1 AND 100),
    class_id TEXT NOT NULL,
    check_type TEXT NOT NULL CHECK (check_type IN ('tooth', 'milk', 'lunch')),
    check_date TEXT NOT NULL,
    student_id TEXT NOT NULL,
    passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
    reason TEXT,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'checker')),
    actor_teacher_id TEXT,
    actor_student_id TEXT,
    series_revision INTEGER NOT NULL CHECK (series_revision > 0),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (actor_student_id) REFERENCES students(id),
    UNIQUE (class_id, request_id),
    CHECK (
      (actor_type = 'teacher' AND actor_teacher_id IS NOT NULL AND actor_student_id IS NULL)
      OR (actor_type = 'checker' AND actor_teacher_id IS NULL AND actor_student_id IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS life_check_events_scope_idx
    ON life_check_events(class_id, check_type, created_at DESC)`,
  `CREATE TRIGGER IF NOT EXISTS life_check_events_insert_guard
    BEFORE INSERT ON life_check_events
    WHEN LENGTH(COALESCE(NEW.reason, '')) > 160
      OR NOT EXISTS (
        SELECT 1
        FROM life_check_records record
        JOIN life_check_series series
          ON series.class_id = record.class_id
         AND series.check_type = record.check_type
        WHERE record.class_id = NEW.class_id
          AND record.check_type = NEW.check_type
          AND record.check_date = NEW.check_date
          AND record.student_id = NEW.student_id
          AND record.passed = NEW.passed
          AND record.last_actor_type = NEW.actor_type
          AND record.last_actor_teacher_id IS NEW.actor_teacher_id
          AND record.last_actor_student_id IS NEW.actor_student_id
          AND record.updated_at = NEW.created_at
          AND series.revision = NEW.series_revision
      )
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_EVENT_STATE_INVALID'); END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_events_update_guard
    BEFORE UPDATE ON life_check_events BEGIN
      SELECT RAISE(ABORT, 'LIFE_CHECK_EVENT_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_events_delete_guard
    BEFORE DELETE ON life_check_events BEGIN
      SELECT RAISE(ABORT, 'LIFE_CHECK_EVENT_IMMUTABLE');
    END`,
  `CREATE TABLE IF NOT EXISTS life_check_payouts (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    check_type TEXT NOT NULL CHECK (check_type IN ('tooth', 'milk', 'lunch')),
    payout_year INTEGER NOT NULL CHECK (payout_year BETWEEN 2020 AND 2100),
    payout_month INTEGER NOT NULL CHECK (payout_month BETWEEN 1 AND 12),
    payout_period TEXT NOT NULL CHECK (payout_period IN ('first', 'second')),
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'completed', 'cancelled')),
    items_json TEXT NOT NULL CHECK (json_valid(items_json) = 1 AND json_type(items_json) = 'array'),
    recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count > 0),
    total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount > 0),
    source_series_revision INTEGER NOT NULL CHECK (source_series_revision >= 0),
    source_calendar_revision INTEGER NOT NULL CHECK (source_calendar_revision >= 0),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by_actor_type TEXT NOT NULL CHECK (created_by_actor_type IN ('teacher', 'checker')),
    created_by_teacher_id TEXT,
    created_by_student_id TEXT,
    last_actor_type TEXT NOT NULL CHECK (last_actor_type IN ('teacher', 'checker')),
    last_actor_teacher_id TEXT,
    last_actor_student_id TEXT,
    completed_by_actor_type TEXT CHECK (completed_by_actor_type IN ('teacher', 'checker')),
    completed_by_teacher_id TEXT,
    completed_by_student_id TEXT,
    completed_at INTEGER,
    cancelled_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (created_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (created_by_student_id) REFERENCES students(id),
    FOREIGN KEY (last_actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (last_actor_student_id) REFERENCES students(id),
    FOREIGN KEY (completed_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (completed_by_student_id) REFERENCES students(id),
    UNIQUE (class_id, check_type, payout_year, payout_month, payout_period),
    CHECK (
      (created_by_actor_type = 'teacher' AND created_by_teacher_id IS NOT NULL AND created_by_student_id IS NULL)
      OR (created_by_actor_type = 'checker' AND created_by_teacher_id IS NULL AND created_by_student_id IS NOT NULL)
    ),
    CHECK (
      (last_actor_type = 'teacher' AND last_actor_teacher_id IS NOT NULL AND last_actor_student_id IS NULL)
      OR (last_actor_type = 'checker' AND last_actor_teacher_id IS NULL AND last_actor_student_id IS NOT NULL)
    ),
    CHECK (
      (status = 'completed'
        AND completed_by_actor_type IS NOT NULL
        AND completed_at IS NOT NULL
        AND cancelled_at IS NULL
        AND ((completed_by_actor_type = 'teacher' AND completed_by_teacher_id IS NOT NULL AND completed_by_student_id IS NULL)
          OR (completed_by_actor_type = 'checker' AND completed_by_teacher_id IS NULL AND completed_by_student_id IS NOT NULL)))
      OR (status = 'cancelled'
        AND completed_by_actor_type IS NULL
        AND completed_by_teacher_id IS NULL
        AND completed_by_student_id IS NULL
        AND completed_at IS NULL
        AND cancelled_at IS NOT NULL)
      OR (status = 'prepared'
        AND completed_by_actor_type IS NULL
        AND completed_by_teacher_id IS NULL
        AND completed_by_student_id IS NULL
        AND completed_at IS NULL
        AND cancelled_at IS NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS life_check_payouts_id_class_uq
    ON life_check_payouts(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS life_check_payouts_scope_idx
    ON life_check_payouts(class_id, payout_year DESC, payout_month DESC, payout_period)`,
  `DROP TRIGGER IF EXISTS life_check_payouts_insert_guard`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payouts_insert_guard
    BEFORE INSERT ON life_check_payouts
    WHEN json_array_length(NEW.items_json) <> NEW.recipient_count
      OR COALESCE((
        SELECT SUM(CAST(json_extract(item.value, '$.amount') AS INTEGER))
        FROM json_each(NEW.items_json) item
      ), 0) <> NEW.total_amount
      OR EXISTS (
        SELECT 1 FROM json_each(NEW.items_json) item
        WHERE json_type(item.value) <> 'object'
          OR json_type(item.value, '$.studentId') <> 'text'
          OR json_type(item.value, '$.amount') <> 'integer'
          OR CAST(json_extract(item.value, '$.amount') AS INTEGER) <= 0
          OR NOT EXISTS (
            SELECT 1 FROM students student
            WHERE student.id = json_extract(item.value, '$.studentId')
              AND student.class_id = NEW.class_id
              AND student.status <> 'excluded'
          )
      )
      OR NOT EXISTS (
        SELECT 1 FROM classes classroom
        JOIN life_check_series series ON series.class_id = classroom.id
        WHERE classroom.id = NEW.class_id
          AND classroom.status = 'active'
          AND series.check_type = NEW.check_type
          AND series.revision = NEW.source_series_revision
          AND COALESCE((
            SELECT revision FROM class_calendars
            WHERE class_id = NEW.class_id
          ), 0) = NEW.source_calendar_revision
          AND (
            (NEW.created_by_actor_type = 'teacher'
              AND classroom.teacher_id = NEW.created_by_teacher_id)
            OR (NEW.created_by_actor_type = 'checker' AND EXISTS (
              SELECT 1
              FROM student_effective_permissions permission
              WHERE permission.student_id = NEW.created_by_student_id
                AND permission.class_id = NEW.class_id
                AND permission.permission_key = CASE NEW.check_type
                  WHEN 'tooth' THEN 'life_check_tooth'
                  WHEN 'milk' THEN 'life_check_milk'
                  WHEN 'lunch' THEN 'life_check_lunch'
                END
            ))
          )
      )
      OR NEW.last_actor_type <> NEW.created_by_actor_type
      OR NEW.last_actor_teacher_id IS NOT NEW.created_by_teacher_id
      OR NEW.last_actor_student_id IS NOT NEW.created_by_student_id
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_STATE_INVALID'); END`,
  `DROP TRIGGER IF EXISTS life_check_payouts_update_guard`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payouts_update_guard
    BEFORE UPDATE ON life_check_payouts
    WHEN NEW.id <> OLD.id
      OR NEW.class_id <> OLD.class_id
      OR NEW.check_type <> OLD.check_type
      OR NEW.payout_year <> OLD.payout_year
      OR NEW.payout_month <> OLD.payout_month
      OR NEW.payout_period <> OLD.payout_period
      OR NEW.created_by_actor_type <> OLD.created_by_actor_type
      OR NEW.created_by_teacher_id IS NOT OLD.created_by_teacher_id
      OR NEW.created_by_student_id IS NOT OLD.created_by_student_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at < OLD.updated_at
      OR NOT (
        (OLD.status = 'prepared' AND NEW.status IN ('prepared', 'completed', 'cancelled'))
        OR (OLD.status IN ('completed', 'cancelled') AND NEW.status = 'prepared')
      )
      OR (OLD.status IN ('completed', 'cancelled')
        AND NEW.status = 'prepared'
        AND NEW.last_actor_type <> 'teacher')
      OR NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.status = 'active'
          AND (
            (NEW.last_actor_type = 'teacher'
              AND classroom.teacher_id = NEW.last_actor_teacher_id)
            OR (NEW.last_actor_type = 'checker' AND EXISTS (
              SELECT 1
              FROM student_effective_permissions permission
              WHERE permission.student_id = NEW.last_actor_student_id
                AND permission.class_id = NEW.class_id
                AND permission.permission_key = CASE NEW.check_type
                  WHEN 'tooth' THEN 'life_check_tooth'
                  WHEN 'milk' THEN 'life_check_milk'
                  WHEN 'lunch' THEN 'life_check_lunch'
                END
            ))
          )
      )
      OR (NOT (OLD.status = 'prepared' AND NEW.status = 'prepared') AND (
        NEW.items_json <> OLD.items_json
        OR NEW.recipient_count <> OLD.recipient_count
        OR NEW.total_amount <> OLD.total_amount
        OR NEW.source_series_revision <> OLD.source_series_revision
        OR NEW.source_calendar_revision <> OLD.source_calendar_revision
      ))
      OR json_array_length(NEW.items_json) <> NEW.recipient_count
      OR COALESCE((
        SELECT SUM(CAST(json_extract(item.value, '$.amount') AS INTEGER))
        FROM json_each(NEW.items_json) item
      ), 0) <> NEW.total_amount
      OR EXISTS (
        SELECT 1 FROM json_each(NEW.items_json) item
        WHERE json_type(item.value) <> 'object'
          OR json_type(item.value, '$.studentId') <> 'text'
          OR json_type(item.value, '$.amount') <> 'integer'
          OR CAST(json_extract(item.value, '$.amount') AS INTEGER) <= 0
          OR ((NEW.status = 'completed'
            OR NEW.items_json <> OLD.items_json
            OR NEW.source_series_revision <> OLD.source_series_revision
            OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
            AND NOT EXISTS (
            SELECT 1 FROM students student
            WHERE student.id = json_extract(item.value, '$.studentId')
              AND student.class_id = NEW.class_id
              AND student.status <> 'excluded'
          ))
      )
      OR ((NEW.status = 'completed'
        OR NEW.items_json <> OLD.items_json
        OR NEW.source_series_revision <> OLD.source_series_revision
        OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
        AND NOT EXISTS (
        SELECT 1 FROM life_check_series series
        WHERE series.class_id = NEW.class_id
          AND series.check_type = NEW.check_type
          AND series.revision = NEW.source_series_revision
      ))
      OR ((NEW.status = 'completed'
        OR NEW.items_json <> OLD.items_json
        OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
        AND COALESCE((
          SELECT revision FROM class_calendars
          WHERE class_id = NEW.class_id
        ), 0) <> NEW.source_calendar_revision)
      OR (NEW.status = 'completed' AND (
        NEW.completed_by_actor_type <> NEW.last_actor_type
        OR NEW.completed_by_teacher_id IS NOT NEW.last_actor_teacher_id
        OR NEW.completed_by_student_id IS NOT NEW.last_actor_student_id
      ))
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_STALE_OR_INVALID'); END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payouts_delete_guard
    BEFORE DELETE ON life_check_payouts
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS life_check_payout_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL CHECK (LENGTH(request_id) BETWEEN 1 AND 100),
    payout_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('prepared', 'refreshed', 'completed', 'cancelled', 'reopened')),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('teacher', 'checker')),
    actor_teacher_id TEXT,
    actor_student_id TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (payout_id, class_id) REFERENCES life_check_payouts(id, class_id),
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (actor_student_id) REFERENCES students(id),
    UNIQUE (class_id, request_id),
    CHECK (detail IS NULL OR json_valid(detail) = 1),
    CHECK (
      (actor_type = 'teacher' AND actor_teacher_id IS NOT NULL AND actor_student_id IS NULL)
      OR (actor_type = 'checker' AND actor_teacher_id IS NULL AND actor_student_id IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS life_check_payout_events_scope_idx
    ON life_check_payout_events(class_id, created_at DESC)`,
  `DROP TRIGGER IF EXISTS life_check_payout_events_insert_guard`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payout_events_insert_guard
    BEFORE INSERT ON life_check_payout_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM life_check_payouts payout
      JOIN classes classroom ON classroom.id = payout.class_id
      WHERE payout.id = NEW.payout_id
        AND payout.class_id = NEW.class_id
        AND classroom.status = 'active'
        AND NEW.created_at = payout.updated_at
        AND payout.last_actor_type = NEW.actor_type
        AND payout.last_actor_teacher_id IS NEW.actor_teacher_id
        AND payout.last_actor_student_id IS NEW.actor_student_id
        AND CAST(json_extract(NEW.detail, '$.revision') AS INTEGER) = payout.revision
        AND json(json_extract(NEW.detail, '$.items')) = json(payout.items_json)
        AND (
          (NEW.action IN ('prepared', 'refreshed', 'reopened') AND payout.status = 'prepared')
          OR (NEW.action = 'completed' AND payout.status = 'completed')
          OR (NEW.action = 'cancelled' AND payout.status = 'cancelled')
        )
        AND (NEW.action <> 'reopened' OR NEW.actor_type = 'teacher')
        AND (
          (NEW.actor_type = 'teacher' AND classroom.teacher_id = NEW.actor_teacher_id)
          OR (NEW.actor_type = 'checker' AND EXISTS (
            SELECT 1
            FROM student_effective_permissions permission
            WHERE permission.student_id = NEW.actor_student_id
              AND permission.class_id = NEW.class_id
              AND permission.permission_key = CASE payout.check_type
                WHEN 'tooth' THEN 'life_check_tooth'
                WHEN 'milk' THEN 'life_check_milk'
                WHEN 'lunch' THEN 'life_check_lunch'
              END
          ))
        )
    )
    BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_EVENT_STATE_INVALID'); END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payout_events_update_guard
    BEFORE UPDATE ON life_check_payout_events BEGIN
      SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_EVENT_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS life_check_payout_events_delete_guard
    BEFORE DELETE ON life_check_payout_events BEGIN
      SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_EVENT_IMMUTABLE');
    END`,
] as const;

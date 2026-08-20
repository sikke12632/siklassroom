import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration0044 = path.join(projectRoot, "drizzle", "0044_job_configuration_plans.sql");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const localD1ConfigPath = "tests/fixtures/wrangler.life-check.jsonc";

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 30 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(result.status, 0, output.slice(-8000));
  } else {
    assert.notEqual(result.status, 0, "제약을 위반한 D1 변경은 실패해야 합니다.");
  }
  return { ...result, output };
}

function executeSql({ configPath, persistPath }, sql, options) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--config=${configPath}`,
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ], options);
  if (result.status !== 0) return result;
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

async function localDatabase(scratchRoot) {
  const persistPath = path.join(scratchRoot, "state");
  return { configPath: localD1ConfigPath, persistPath };
}

function currentOperationalRows(database) {
  const row = lastResults(executeSql(database, `
    SELECT
      (SELECT COUNT(*) FROM teachers) AS teacher_count,
      (SELECT COUNT(*) FROM classes) AS class_count,
      (SELECT COUNT(*) FROM students) AS student_count,
      (SELECT COUNT(*) FROM class_job_setup) AS setup_count,
      (SELECT COUNT(*) FROM class_jobs) AS job_count,
      (SELECT COUNT(*) FROM class_job_assignment_periods) AS period_count,
      (SELECT COUNT(*) FROM student_job_assignments) AS assignment_count,
      (SELECT json_group_array(json_object(
         'classId', class_id, 'status', status, 'jobCount', selected_job_count,
         'capacity', selected_capacity, 'revision', revision
       )) FROM (SELECT * FROM class_job_setup ORDER BY class_id)) AS setup_json,
      (SELECT json_group_array(json_object(
         'id', id, 'classId', class_id, 'templateId', template_id,
         'name', name, 'capacity', member_capacity, 'active', is_active
       )) FROM (SELECT * FROM class_jobs ORDER BY id)) AS jobs_json,
      (SELECT json_group_array(json_object(
         'periodId', period_id, 'jobId', class_job_id,
         'studentId', student_id, 'method', assignment_method
       )) FROM (SELECT * FROM student_job_assignments ORDER BY id)) AS assignments_json,
      (SELECT json_group_array(json_object(
         'key', permission_key, 'periodId', period_id, 'source', permission_source
       )) FROM (
         SELECT permission_key, period_id, permission_source
         FROM student_effective_permissions
         WHERE student_id = 'student-banker'
         ORDER BY permission_key, permission_source
       )) AS permissions_json;
  `))[0];
  return {
    teacherCount: Number(row.teacher_count),
    classCount: Number(row.class_count),
    studentCount: Number(row.student_count),
    setupCount: Number(row.setup_count),
    jobCount: Number(row.job_count),
    periodCount: Number(row.period_count),
    assignmentCount: Number(row.assignment_count),
    setup: JSON.parse(row.setup_json),
    jobs: JSON.parse(row.jobs_json),
    assignments: JSON.parse(row.assignments_json),
    permissions: JSON.parse(row.permissions_json),
  };
}

test("0044 다음 달 직업 계획은 기존 배정 데이터를 건드리지 않고 현재 역할 권한을 보존한다", async () => {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "siklassroom-job-plan-migration-"));
  try {
    const database = await localDatabase(scratchRoot);
    executeSql(database, `
      PRAGMA foreign_keys = ON;
      CREATE TABLE teachers (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE classes (
        id TEXT PRIMARY KEY NOT NULL,
        teacher_id TEXT NOT NULL,
        school_name TEXT NOT NULL,
        school_normalized TEXT NOT NULL,
        school_year INTEGER NOT NULL,
        grade INTEGER NOT NULL,
        class_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id)
      );
      CREATE TABLE students (
        id TEXT PRIMARY KEY NOT NULL,
        class_id TEXT NOT NULL,
        student_number INTEGER NOT NULL,
        official_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id)
      );
      CREATE TABLE class_job_setup (
        class_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        setup_mode TEXT,
        survey_answers TEXT,
        draft_jobs TEXT,
        student_count_snapshot INTEGER NOT NULL,
        selected_job_count INTEGER NOT NULL,
        selected_capacity INTEGER NOT NULL,
        last_step INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id)
      );
      CREATE TABLE job_templates (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        short_description TEXT NOT NULL,
        detailed_tasks TEXT NOT NULL,
        category TEXT NOT NULL,
        recommended_min_members INTEGER NOT NULL,
        recommended_max_members INTEGER NOT NULL,
        icon_key TEXT NOT NULL,
        default_priority INTEGER NOT NULL,
        is_active INTEGER NOT NULL
      );
      CREATE TABLE class_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        class_id TEXT NOT NULL,
        template_id TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        member_capacity INTEGER NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id),
        FOREIGN KEY (template_id) REFERENCES job_templates(id)
      );
      CREATE TABLE class_job_assignment_periods (
        id TEXT PRIMARY KEY NOT NULL,
        class_id TEXT NOT NULL,
        assignment_year INTEGER NOT NULL,
        assignment_month INTEGER NOT NULL,
        assignment_type TEXT NOT NULL,
        mode TEXT,
        status TEXT NOT NULL,
        confirmed_at INTEGER,
        confirmed_by_teacher_id TEXT,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id)
      );
      CREATE TABLE student_job_assignments (
        id TEXT PRIMARY KEY NOT NULL,
        period_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        class_job_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        assignment_method TEXT NOT NULL,
        request_id TEXT,
        assignment_sequence INTEGER NOT NULL,
        assigned_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (period_id) REFERENCES class_job_assignment_periods(id),
        FOREIGN KEY (class_id) REFERENCES classes(id),
        FOREIGN KEY (class_job_id) REFERENCES class_jobs(id),
        FOREIGN KEY (student_id) REFERENCES students(id)
      );
      CREATE TABLE student_manual_permissions (
        id TEXT PRIMARY KEY NOT NULL,
        class_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        permission_key TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        granted_by_teacher_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE VIEW student_effective_permissions AS
      SELECT assignment.class_id,
             assignment.student_id,
             'finance_banker' AS permission_key,
             period.id AS period_id,
             'automatic' AS permission_source
      FROM student_job_assignments assignment
      JOIN class_job_assignment_periods period ON period.id = assignment.period_id
      JOIN class_jobs job ON job.id = assignment.class_job_id
      JOIN students student ON student.id = assignment.student_id
      JOIN classes classroom ON classroom.id = assignment.class_id
      WHERE period.status = 'confirmed'
        AND period.assignment_type IN ('initial', 'monthly')
        AND job.is_active = 1
        AND job.template_id = 'banker'
        AND student.status = 'active'
        AND classroom.status = 'active';
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-jobs', 'teacher-jobs@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-jobs', 'teacher-jobs', '직업초', '직업초',
        CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
        6, 1, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-banker', 'class-jobs', 1, '은행학생', 'active', 1, 1),
        ('student-unassigned', 'class-jobs', 2, '미배정학생', 'active', 1, 1);
      INSERT INTO job_templates (
        id, name, short_description, detailed_tasks, category,
        recommended_min_members, recommended_max_members,
        icon_key, default_priority, is_active
      ) VALUES (
        'banker', '은행원', '학급 은행을 운영해요.', '학급 은행을 운영해요.',
        'economy', 1, 2, 'bank', 1, 1
      );
      INSERT INTO class_job_setup (
        class_id, status, setup_mode, survey_answers, draft_jobs,
        student_count_snapshot, selected_job_count, selected_capacity,
        last_step, revision, completed_at, updated_at
      ) VALUES (
        'class-jobs', 'completed', 'manual', '{}', '[]',
        2, 2, 4, 4, 7, 2, 2
      );
      INSERT INTO class_jobs (
        id, class_id, template_id, name, description, member_capacity,
        category, source, sort_order, is_active, created_at, updated_at
      ) VALUES
      (
        'class-jobs:banker', 'class-jobs', 'banker', '은행원',
        '학급 은행을 운영해요.', 2, 'economy', 'template', 0, 1, 2, 2
      ),
      (
        'class-jobs:helper', 'class-jobs', NULL, '학급 도우미',
        '친구들을 도와요.', 2, 'life', 'custom', 1, 1, 2, 2
      );
      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        mode, status, confirmed_at, confirmed_by_teacher_id, revision,
        created_at, updated_at
      ) VALUES
      (
        'period-current', 'class-jobs',
        CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
        CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
        'initial', 'manual', 'confirmed', 3, 'teacher-jobs', 1, 2, 3
      ),
      (
        'period-old', 'class-jobs',
        CAST(strftime('%Y', 'now', '+9 hours', 'start of month', '-1 month') AS INTEGER),
        CAST(strftime('%m', 'now', '+9 hours', 'start of month', '-1 month') AS INTEGER),
        'monthly', 'student_choice', 'confirmed', 2, 'teacher-jobs', 1, 1, 2
      ),
      (
        'period-future', 'class-jobs',
        CAST(strftime('%Y', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
        CAST(strftime('%m', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
        'monthly', 'student_choice', 'confirmed', 4, 'teacher-jobs', 1, 4, 4
      );
      INSERT INTO student_job_assignments (
        id, period_id, class_id, class_job_id, student_id,
        assignment_method, request_id, assignment_sequence, assigned_at, created_at
      ) VALUES
      (
        'assignment-banker', 'period-current', 'class-jobs',
        'class-jobs:banker', 'student-banker', 'manual',
        'current:student-banker', 1, 3, 3
      ),
      (
        'assignment-old-helper', 'period-old', 'class-jobs',
        'class-jobs:helper', 'student-unassigned', 'choice',
        'old:student-unassigned', 1, 2, 2
      ),
      (
        'assignment-future-helper', 'period-future', 'class-jobs',
        'class-jobs:helper', 'student-unassigned', 'choice',
        'future:student-unassigned', 1, 4, 4
      );
    `);

    const before = currentOperationalRows(database);
    assert.deepEqual(before.permissions, [{
      key: "finance_banker",
      periodId: "period-current",
      source: "automatic",
    }]);

    runWrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      `--config=${database.configPath}`,
      `--persist-to=${database.persistPath}`,
      `--file=${migration0044}`,
    ]);

    assert.deepEqual(currentOperationalRows(database), before);

    executeSql(database, `
      INSERT INTO class_job_change_plans (
        id, class_id, target_year, target_month, jobs_json, status,
        base_setup_revision, revision, created_by_teacher_id,
        created_at, updated_at
      ) VALUES (
        'plan-next', 'class-jobs',
        CAST(strftime('%Y', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
        CAST(strftime('%m', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
        '[{"id":"class-jobs:banker","templateId":"banker","name":"은행원","description":"학급 은행을 운영해요.","memberCapacity":1,"category":"economy","source":"template","sortOrder":0}]',
        'draft', 7, 1, 'teacher-jobs', 4, 4
      );
    `);
    assert.deepEqual(currentOperationalRows(database), before);
    assert.deepEqual(lastResults(executeSql(database, `
      SELECT status, base_setup_revision, revision
      FROM class_job_change_plans WHERE id = 'plan-next';
    `)), [{ status: "draft", base_setup_revision: 7, revision: 1 }]);

    executeSql(database, `
      UPDATE class_jobs SET is_active = 0, updated_at = 5
      WHERE id = 'class-jobs:banker';
    `);
    assert.deepEqual(lastResults(executeSql(database, `
      SELECT permission_key, period_id, permission_source
      FROM student_effective_permissions
      WHERE student_id = 'student-banker';
    `)), [{
      permission_key: "finance_banker",
      period_id: "period-current",
      permission_source: "automatic",
    }], "확정 배정의 역할 권한은 이후 직업의 활성 표시가 바뀌어도 유지되어야 합니다.");

    const overviewContract = lastResults(executeSql(database, `
      WITH latest_period AS (
        SELECT id
        FROM class_job_assignment_periods
        WHERE class_id = 'class-jobs'
          AND status = 'confirmed'
          AND assignment_type IN ('initial', 'monthly')
          AND (
            assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
            OR (
              assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
              AND assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
            )
          )
        ORDER BY assignment_year DESC, assignment_month DESC,
                 confirmed_at DESC, updated_at DESC
        LIMIT 1
      ), current_assignments AS (
        SELECT assignment.*
        FROM student_job_assignments assignment
        JOIN latest_period period ON period.id = assignment.period_id
      )
      SELECT
        (SELECT id FROM latest_period) AS period_id,
        (SELECT COUNT(*) FROM current_assignments
          WHERE student_id = 'student-unassigned') AS forbidden_fallback_count,
        (SELECT COUNT(*) FROM current_assignments
          WHERE class_job_id = 'class-jobs:banker') AS retired_assignment_count,
        (SELECT member_capacity FROM class_jobs
          WHERE id = 'class-jobs:helper')
          - (SELECT COUNT(*) FROM current_assignments
             WHERE class_job_id = 'class-jobs:helper') AS helper_vacancies,
        (SELECT revision FROM class_job_change_plans
          WHERE id = 'plan-next') AS next_plan_revision;
    `));
    assert.deepEqual(overviewContract, [{
      period_id: "period-current",
      forbidden_fallback_count: 0,
      retired_assignment_count: 1,
      helper_vacancies: 2,
      next_plan_revision: 1,
    }], "현황은 미래/과거 배정으로 보충하지 않고 최신 확정 월의 공석과 퇴역 직업 배정을 그대로 보여야 합니다.");

    for (const [id, targetMonth, status, revision, expectedError] of [
      ["bad-month", 13, "draft", 1, /class_job_change_plans_month_ck/],
      ["bad-status", 2, "pending", 1, /class_job_change_plans_status_ck/],
      ["bad-revision", 3, "draft", 0, /class_job_change_plans_revision_ck/],
    ]) {
      const denied = executeSql(database, `
        INSERT INTO class_job_change_plans (
          id, class_id, target_year, target_month, jobs_json, status,
          base_setup_revision, revision, created_by_teacher_id,
          created_at, updated_at
        ) VALUES (
          '${id}', 'class-jobs', 2099, ${targetMonth}, '[]', '${status}',
          7, ${revision}, 'teacher-jobs', 5, 5
        );
      `, { expectSuccess: false });
      assert.match(denied.output, expectedError);
    }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

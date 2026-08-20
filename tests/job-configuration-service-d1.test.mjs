import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "tests", "fixtures", "wrangler.job-configuration-service.jsonc");

async function call(worker, action, input) {
  const response = await worker.fetch("http://test.local/", {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({ action, input }),
  });
  return { response, body: await response.json() };
}

async function querySql(worker, sql, values = []) {
  const result = await call(worker, "test-query", { sql, values });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.results;
}

async function runSql(worker, sql, values = []) {
  const result = await call(worker, "test-run", { sql, values });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, true);
}

function draft(id, overrides = {}) {
  return {
    id, templateId: "banker", name: "은행원", description: "학급 은행을 운영해요.",
    memberCapacity: 2, category: "economy", source: "template", sortOrder: 0,
    ...overrides,
  };
}

test("직업 구성 서비스는 월별 계획과 즉시 변경에서 배정 이력을 버전으로 보존한다", async () => {
  let harness;
  let worker;
  try {
    const { createTestHarness } = await import("wrangler");
    harness = createTestHarness({
      root: projectRoot,
      workers: [{ configPath }],
    });
    await harness.listen();
    worker = harness.getWorker();
    await worker.applyD1Migrations("DB");
    const seeded = await call(worker, "test-exec", { sql: `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-job-config', 'job-config@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES
        ('class-plan-stale', 'teacher-job-config', '직업초', '직업초',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER), 6, 1, 'active', 1, 1),
        ('class-plan-apply', 'teacher-job-config', '직업초', '직업초',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER), 6, 2, 'active', 1, 1),
        ('class-current-apply', 'teacher-job-config', '직업초', '직업초',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER), 6, 3, 'active', 1, 1),
        ('class-future-initial', 'teacher-job-config', '직업초', '직업초',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER), 6, 4, 'active', 1, 1);
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-plan-stale', 'class-plan-stale', 1, '계획학생', 'active', 1, 1),
        ('student-plan-apply', 'class-plan-apply', 1, '적용학생', 'active', 1, 1),
        ('student-current-banker', 'class-current-apply', 1, '은행학생', 'active', 1, 1),
        ('student-current-market', 'class-current-apply', 2, '마트학생', 'active', 1, 1),
        ('student-future', 'class-future-initial', 1, '예정학생', 'active', 1, 1);
      INSERT OR IGNORE INTO job_templates (
        id, name, short_description, detailed_tasks, category,
        recommended_min_members, recommended_max_members,
        icon_key, default_priority, is_active
      ) VALUES
        ('banker', '은행원', '은행', '은행 업무', 'economy', 1, 2, 'bank', 1, 1),
        ('market-clerk', '마트원', '마트', '마트 업무', 'economy', 1, 2, 'store', 2, 1);
      INSERT INTO class_job_setup (
        class_id, status, setup_mode, survey_answers, draft_jobs,
        student_count_snapshot, selected_job_count, selected_capacity,
        last_step, revision, completed_at, updated_at
      ) VALUES
        ('class-plan-stale', 'completed', 'manual', '{}', '[]', 1, 1, 2, 4, 5, 1, 1),
        ('class-plan-apply', 'completed', 'manual', '{}', '[]', 1, 1, 2, 4, 5, 1, 1),
        ('class-current-apply', 'completed', 'manual', '{}', '[]', 2, 2, 4, 4, 8, 1, 1);
      INSERT INTO class_job_setup (
        class_id, status, setup_mode, survey_answers, draft_jobs,
        student_count_snapshot, selected_job_count, selected_capacity,
        last_step, revision, completed_at, updated_at
      ) VALUES
        ('class-future-initial', 'completed', 'manual', '{}', '[]', 1, 1, 2, 4, 4, 1, 1);
      INSERT INTO class_jobs (
        id, class_id, template_id, name, description, member_capacity,
        category, source, sort_order, is_active, created_at, updated_at
      ) VALUES
        ('class-plan-stale:banker', 'class-plan-stale', 'banker', '은행원',
         '계획 전 은행 업무', 2, 'economy', 'template', 0, 1, 1, 1),
        ('class-plan-apply:banker', 'class-plan-apply', 'banker', '은행원',
         '적용 전 은행 업무', 2, 'economy', 'template', 0, 1, 1, 1),
        ('class-current-apply:banker', 'class-current-apply', 'banker', '은행원',
         '변경 전 은행 업무', 2, 'economy', 'template', 0, 1, 1, 1),
        ('class-current-apply:market', 'class-current-apply', 'market-clerk', '마트원',
         '변경 전 마트 업무', 2, 'economy', 'template', 1, 1, 1, 1),
        ('class-future-initial:banker', 'class-future-initial', 'banker', '은행원',
         '다음 달 은행 업무', 2, 'economy', 'template', 0, 1, 1, 1);
      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        mode, status, confirmed_at, confirmed_by_teacher_id, revision,
        created_at, updated_at
      ) VALUES
        ('period-plan-stale', 'class-plan-stale',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'initial', 'manual', 'confirmed', 10, 'teacher-job-config', 1, 10, 10),
        ('period-plan-apply', 'class-plan-apply',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'initial', 'manual', 'confirmed', 10, 'teacher-job-config', 1, 10, 10),
        ('period-current-old', 'class-current-apply',
         CAST(strftime('%Y', 'now', '+9 hours', 'start of month', '-1 month') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours', 'start of month', '-1 month') AS INTEGER),
         'monthly', 'student_choice', 'confirmed', 5, 'teacher-job-config', 1, 5, 5),
        ('period-current-latest', 'class-current-apply',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'monthly', 'student_choice', 'confirmed', 10, 'teacher-job-config', 2, 10, 10),
        ('period-future-initial', 'class-future-initial',
         CAST(strftime('%Y', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours', 'start of month', '+1 month') AS INTEGER),
         'initial', 'manual', 'confirmed', 10, 'teacher-job-config', 1, 10, 10);
      INSERT INTO student_job_assignments (
        id, period_id, class_id, class_job_id, student_id,
        assignment_method, request_id, assignment_sequence, assigned_at, created_at
      ) VALUES
        ('assignment-plan-stale', 'period-plan-stale', 'class-plan-stale',
         'class-plan-stale:banker', 'student-plan-stale', 'manual', 'plan-stale', 1, 10, 10),
        ('assignment-plan-apply', 'period-plan-apply', 'class-plan-apply',
         'class-plan-apply:banker', 'student-plan-apply', 'manual', 'plan-apply', 1, 10, 10),
        ('assignment-current-old', 'period-current-old', 'class-current-apply',
         'class-current-apply:banker', 'student-current-banker', 'choice', 'current-old', 1, 5, 5),
        ('assignment-current-banker', 'period-current-latest', 'class-current-apply',
         'class-current-apply:banker', 'student-current-banker', 'choice', 'current-banker', 1, 10, 10),
        ('assignment-current-market', 'period-current-latest', 'class-current-apply',
         'class-current-apply:market', 'student-current-market', 'choice', 'current-market', 2, 10, 10),
        ('assignment-future', 'period-future-initial', 'class-future-initial',
         'class-future-initial:banker', 'student-future', 'manual', 'future', 1, 10, 10);
      INSERT INTO class_job_month_closures (
        id, class_id, source_period_id, source_year, source_month,
        status, closed_by_teacher_id, closed_at, created_at
      ) VALUES
        ('closure-plan-stale', 'class-plan-stale', 'period-plan-stale',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'closed', 'teacher-job-config', 20, 20),
        ('closure-plan-apply', 'class-plan-apply', 'period-plan-apply',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'closed', 'teacher-job-config', 20, 20);
    ` });
    assert.equal(seeded.response.status, 200, JSON.stringify(seeded.body));

    const futureOverview = await call(worker, "overview", { classId: "class-future-initial" });
    assert.equal(futureOverview.response.status, 200, JSON.stringify(futureOverview.body));
    assert.equal(futureOverview.body.period.id, "period-future-initial");
    assert.equal(futureOverview.body.period.isScheduled, true);
    assert.equal(futureOverview.body.futureConfirmedPeriod.id, "period-future-initial");
    assert.equal(futureOverview.body.jobs[0].assignedStudents[0].id, "student-future");
    const futureEdit = await call(worker, "apply-current", {
      classId: "class-future-initial", teacherId: "teacher-job-config",
      expectedSetupRevision: 4, requestId: "future-current-edit",
      jobs: [draft("class-future-initial:banker", { name: "미리 바꾼 은행원" })],
      acknowledgeImpact: true,
    });
    assert.equal(futureEdit.response.status, 409, JSON.stringify(futureEdit.body));
    assert.equal(futureEdit.body.code, "FUTURE_JOB_PERIOD_PENDING");
    assert.deepEqual(await querySql(worker, `
      SELECT class_job_id FROM student_job_assignments WHERE id = 'assignment-future';
    `), [{ class_job_id: "class-future-initial:banker" }]);

    const staleLegacyDraft = await call(worker, "save-legacy-draft", {
      classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 5,
      setupMode: "manual", jobs: [draft("class-plan-stale:banker")],
      lastStep: 3, studentCount: 1,
    });
    assert.equal(staleLegacyDraft.response.status, 409, JSON.stringify(staleLegacyDraft.body));
    assert.equal(staleLegacyDraft.body.code, "JOB_SETUP_COMPLETED");
    assert.deepEqual(await querySql(worker, `
      SELECT status, revision FROM class_job_setup WHERE class_id = 'class-plan-stale';
    `), [{ status: "completed", revision: 5 }],
    "예전 설정 탭의 저장 요청은 완료된 운영 구성을 draft로 되돌리면 안 됩니다.");

    const staleOverview = await call(worker, "overview", { classId: "class-plan-stale" });
    assert.equal(staleOverview.response.status, 200, JSON.stringify(staleOverview.body));
    const staleTarget = staleOverview.body.nextTarget;
    const staleJobs = [draft("class-plan-stale:banker", {
      name: "다음 은행원", description: "다음 달 은행 업무", memberCapacity: 1,
    })];
    for (const [requestId, expectedSetupRevision, targetYear, targetMonth] of [
      ["plan-wrong-setup", 4, staleTarget.year, staleTarget.month],
      ["plan-wrong-target", 5, staleTarget.year, staleTarget.month === 12 ? 1 : staleTarget.month + 1],
    ]) {
      const denied = await call(worker, "save-plan", {
        classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 0,
        expectedSetupRevision, expectedTargetYear: targetYear, expectedTargetMonth: targetMonth,
        requestId, jobs: staleJobs,
      });
      assert.equal(denied.response.status, 409, JSON.stringify(denied.body));
      assert.equal(denied.body.code, "JOB_PLAN_STALE");
    }
    const savedStalePlan = await call(worker, "save-plan", {
      classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 0,
      expectedSetupRevision: 5, expectedTargetYear: staleTarget.year,
      expectedTargetMonth: staleTarget.month, requestId: "plan-stale-save", jobs: staleJobs,
    });
    assert.equal(savedStalePlan.response.status, 200, JSON.stringify(savedStalePlan.body));
    assert.equal(savedStalePlan.body.plan.revision, 1);
    const staleRevision = await call(worker, "save-plan", {
      classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 0,
      expectedSetupRevision: 5, expectedTargetYear: staleTarget.year,
      expectedTargetMonth: staleTarget.month, requestId: "plan-stale-revision", jobs: staleJobs,
    });
    assert.equal(staleRevision.response.status, 409, JSON.stringify(staleRevision.body));
    assert.equal(staleRevision.body.code, "JOB_PLAN_STALE");

    await runSql(worker, `
      INSERT INTO class_job_choice_sessions (
        id, class_id, closure_id, target_year, target_month, status,
        order_mode, order_json, student_count_snapshot, job_setup_revision,
        revision, created_at, updated_at
      ) VALUES (
        'session-plan-race', 'class-plan-stale', 'closure-plan-stale',
        ${Number(staleTarget.year)}, ${Number(staleTarget.month)}, 'draft',
        'roster', '["student-plan-stale"]', 1, 5, 0, 30, 30
      );
    `);
    const lostResponseRetry = await call(worker, "save-plan", {
      classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 0,
      expectedSetupRevision: 5, expectedTargetYear: staleTarget.year,
      expectedTargetMonth: staleTarget.month, requestId: "plan-stale-save", jobs: staleJobs,
    });
    assert.equal(lostResponseRetry.response.status, 200, JSON.stringify(lostResponseRetry.body));
    assert.equal(lostResponseRetry.body.idempotent, true,
      "저장 응답을 잃은 동일 요청은 다음 흐름이 시작된 뒤에도 성공 결과를 재현해야 합니다.");
    const workflowStarted = await call(worker, "save-plan", {
      classId: "class-plan-stale", teacherId: "teacher-job-config", expectedRevision: 1,
      expectedSetupRevision: 5, expectedTargetYear: staleTarget.year,
      expectedTargetMonth: staleTarget.month, requestId: "plan-after-session", jobs: staleJobs,
    });
    assert.equal(workflowStarted.response.status, 409, JSON.stringify(workflowStarted.body));
    assert.equal(workflowStarted.body.code, "JOB_PLAN_WORKFLOW_STARTED");
    const racedApply = await call(worker, "apply-plan", {
      classId: "class-plan-stale", teacherId: "teacher-job-config",
      targetYear: staleTarget.year, targetMonth: staleTarget.month,
      expectedSourcePeriodId: "period-plan-stale", expectedClosureId: "closure-plan-stale",
    });
    assert.equal(racedApply.response.status, 409, JSON.stringify(racedApply.body));
    assert.equal(racedApply.body.code, "JOB_PLAN_APPLY_STALE");
    assert.deepEqual(await querySql(worker, `
      SELECT plan.status, plan.revision, setup.revision AS setup_revision
      FROM class_job_change_plans plan
      JOIN class_job_setup setup ON setup.class_id = plan.class_id
      WHERE plan.class_id = 'class-plan-stale';
    `), [{ status: "draft", revision: 1, setup_revision: 5 }]);

    const applyOverview = await call(worker, "overview", { classId: "class-plan-apply" });
    assert.equal(applyOverview.response.status, 200, JSON.stringify(applyOverview.body));
    const applyTarget = applyOverview.body.nextTarget;
    const applyJobs = [draft("class-plan-apply:banker", {
      name: "새 은행원", description: "다음 달부터 바뀐 은행 업무", memberCapacity: 1,
    })];
    const savedApplyPlan = await call(worker, "save-plan", {
      classId: "class-plan-apply", teacherId: "teacher-job-config", expectedRevision: 0,
      expectedSetupRevision: 5, expectedTargetYear: applyTarget.year,
      expectedTargetMonth: applyTarget.month, requestId: "plan-apply-save", jobs: applyJobs,
    });
    assert.equal(savedApplyPlan.response.status, 200, JSON.stringify(savedApplyPlan.body));

    await runSql(worker, "UPDATE class_job_setup SET revision = 6 WHERE class_id = 'class-plan-apply'");
    const baseStale = await call(worker, "apply-plan", {
      classId: "class-plan-apply", teacherId: "teacher-job-config",
      targetYear: applyTarget.year, targetMonth: applyTarget.month,
      expectedSourcePeriodId: "period-plan-apply", expectedClosureId: "closure-plan-apply",
    });
    assert.equal(baseStale.response.status, 409, JSON.stringify(baseStale.body));
    assert.equal(baseStale.body.code, "JOB_PLAN_BASE_STALE");
    await runSql(worker, "UPDATE class_job_setup SET revision = 5 WHERE class_id = 'class-plan-apply'");
    const applied = await call(worker, "apply-plan", {
      classId: "class-plan-apply", teacherId: "teacher-job-config",
      targetYear: applyTarget.year, targetMonth: applyTarget.month,
      expectedSourcePeriodId: "period-plan-apply", expectedClosureId: "closure-plan-apply",
    });
    assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.applied, true);

    const planJobRows = await querySql(worker, `
      SELECT id, name, description, is_active FROM class_jobs
      WHERE class_id = 'class-plan-apply' ORDER BY is_active DESC, created_at, id;
    `);
    const appliedJob = planJobRows.find((job) => Number(job.is_active) === 1);
    const previousJob = planJobRows.find((job) => job.id === "class-plan-apply:banker");
    assert.ok(appliedJob);
    assert.notEqual(appliedJob.id, "class-plan-apply:banker");
    assert.equal(appliedJob.name, "새 은행원");
    assert.deepEqual(previousJob, {
      id: "class-plan-apply:banker", name: "은행원",
      description: "적용 전 은행 업무", is_active: 0,
    });
    assert.deepEqual(await querySql(worker, `
      SELECT class_job_id FROM student_job_assignments WHERE id = 'assignment-plan-apply';
    `), [{ class_job_id: "class-plan-apply:banker" }]);
    const [planSnapshots] = await querySql(worker, `
      SELECT status, previous_jobs_json, applied_jobs_json
      FROM class_job_change_plans WHERE class_id = 'class-plan-apply';
    `);
    assert.equal(planSnapshots.status, "applied");
    const previousSnapshot = JSON.parse(planSnapshots.previous_jobs_json);
    const appliedSnapshot = JSON.parse(planSnapshots.applied_jobs_json);
    assert.equal(previousSnapshot[0].id, "class-plan-apply:banker");
    assert.equal(previousSnapshot[0].description, "적용 전 은행 업무");
    assert.equal(appliedSnapshot[0].id, appliedJob.id);
    assert.equal(appliedSnapshot[0].name, "새 은행원");

    const historicalOverview = await call(worker, "overview", { classId: "class-plan-apply" });
    assert.equal(historicalOverview.response.status, 200, JSON.stringify(historicalOverview.body));
    assert.equal(historicalOverview.body.period.id, "period-plan-apply");
    assert.equal(historicalOverview.body.jobs.some((job) => job.id === appliedJob.id), false,
      "미래 적용 구성의 빈 직업은 현재 확정 월 현황에 미리 나타나면 안 됩니다.");
    const historicalBanker = historicalOverview.body.jobs.find(
      (job) => job.id === "class-plan-apply:banker",
    );
    assert.equal(historicalBanker.assignedCount, 1);
    assert.equal(historicalBanker.description, "적용 전 은행 업무");
    assert.deepEqual(await querySql(worker, `
      SELECT permission_key, period_id FROM student_effective_permissions
      WHERE class_id = 'class-plan-apply' AND student_id = 'student-plan-apply';
    `), [{ permission_key: "finance_banker", period_id: "period-plan-apply" }]);

    const currentApplied = await call(worker, "apply-current", {
      classId: "class-current-apply", teacherId: "teacher-job-config",
      expectedSetupRevision: 8, requestId: "current-versioned-apply",
      jobs: [draft("class-current-apply:banker", {
        name: "은행장", description: "오늘부터 바뀐 은행 업무", memberCapacity: 1,
      })],
      acknowledgeImpact: true,
    });
    assert.equal(currentApplied.response.status, 200, JSON.stringify(currentApplied.body));
    assert.equal(currentApplied.body.setupRevision, 9);
    const currentJobRows = await querySql(worker, `
      SELECT id, template_id, name, description, is_active FROM class_jobs
      WHERE class_id = 'class-current-apply' ORDER BY is_active DESC, created_at, id;
    `);
    const activeBanker = currentJobRows.find((job) => Number(job.is_active) === 1);
    assert.ok(activeBanker);
    assert.notEqual(activeBanker.id, "class-current-apply:banker");
    assert.equal(activeBanker.name, "은행장");
    assert.deepEqual(currentJobRows.find((job) => job.id === "class-current-apply:banker"), {
      id: "class-current-apply:banker", template_id: "banker", name: "은행원",
      description: "변경 전 은행 업무", is_active: 0,
    });
    assert.equal(currentJobRows.find((job) => job.id === "class-current-apply:market").is_active, 0);
    assert.deepEqual(await querySql(worker, `
      SELECT id, period_id, class_job_id FROM student_job_assignments
      WHERE class_id = 'class-current-apply' ORDER BY id;
    `), [
      { id: "assignment-current-banker", period_id: "period-current-latest", class_job_id: activeBanker.id },
      { id: "assignment-current-market", period_id: "period-current-latest", class_job_id: "class-current-apply:market" },
      { id: "assignment-current-old", period_id: "period-current-old", class_job_id: "class-current-apply:banker" },
    ]);
    assert.deepEqual(await querySql(worker, `
      SELECT student_id, permission_key, period_id FROM student_effective_permissions
      WHERE class_id = 'class-current-apply' ORDER BY student_id, permission_key;
    `), [
      { student_id: "student-current-banker", permission_key: "finance_banker", period_id: "period-current-latest" },
      { student_id: "student-current-market", permission_key: "mart_operator", period_id: "period-current-latest" },
    ]);
    assert.deepEqual(await querySql(worker, `
      SELECT id, revision FROM class_job_assignment_periods
      WHERE class_id = 'class-current-apply' ORDER BY assignment_year, assignment_month;
    `), [
      { id: "period-current-old", revision: 1 },
      { id: "period-current-latest", revision: 3 },
    ], "즉시 반영은 최신 운영 월의 배정 revision만 올리고 과거 월은 바꾸면 안 됩니다.");
    const currentOverview = currentApplied.body.overview;
    const overviewBanker = currentOverview.jobs.find((job) => job.id === activeBanker.id);
    const overviewMarket = currentOverview.jobs.find((job) => job.id === "class-current-apply:market");
    assert.equal(overviewBanker.assignedStudents[0].id, "student-current-banker");
    assert.equal(overviewMarket.retired, true);
    assert.equal(overviewMarket.assignedStudents[0].id, "student-current-market");
    assert.equal(currentOverview.jobs.some((job) => job.id === "class-current-apply:banker"), false,
      "과거 월의 옛 직업 버전은 현재 월 현황에 섞이면 안 됩니다.");
  } finally {
    await harness?.close();
  }
});

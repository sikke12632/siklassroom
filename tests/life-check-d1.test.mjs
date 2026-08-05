import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const workerPath = "tests/fixtures/life-check-worker.ts";
const configPath = path.join(projectRoot, "tests", "fixtures", "wrangler.life-check.jsonc");

function runWrangler(args, { expectSuccess = true } = {}) {
  let result;
  let output = "";
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = spawnSync(process.execPath, [wranglerPath, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0 || (!output.includes("bad port") && !output.includes("fetch failed"))) break;
    Atomics.wait(retrySignal, 0, 0, 250 * (attempt + 1));
  }
  assert.ok(result);
  if (expectSuccess) {
    assert.equal(result.status, 0, `Wrangler command failed.\n${output.slice(-5000)}`);
  } else {
    assert.notEqual(result.status, 0, "The D1 command should have failed.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, options) {
  const result = runWrangler([
    "d1", "execute", "DB", "--config", configPath, "--local",
    `--persist-to=${persistPath}`, "--json", "--command", sql,
  ], options);
  if (result.status !== 0) return result;
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function seoulMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month, value: `${year}-${String(month).padStart(2, "0")}` };
}

function shiftedMonth(source, offset) {
  const date = new Date(Date.UTC(source.year, source.month - 1 + offset, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { year, month, value: `${year}-${String(month).padStart(2, "0")}` };
}

function calendarRows(classId, monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = `${monthValue}-${String(day).padStart(2, "0")}`;
    const dayType = day <= 4 ? "class" : "off";
    return `('calendar-${classId}-${day}', '${classId}', '${date}', '${dayType}', NULL, 1, 1)`;
  }).join(",\n");
}

async function call(worker, token, pathName, init = {}) {
  const response = await worker.fetch(`http://test.local${pathName}`, {
    ...init,
    headers: {
      cookie: `job_classroom_session=${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { response, body: await response.json() };
}

function body(value) {
  return JSON.stringify(value);
}

test("생활확인은 직업 권한·학급 격리·중복 방지·기록 전용 지급을 D1에서 보장한다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-life-check-d1-"));
  let worker;
  try {
    runWrangler([
      "d1", "migrations", "apply", "DB", "--config", configPath,
      "--local", `--persist-to=${persistPath}`,
    ]);

    const current = seoulMonth();
    const payoutMonth = shiftedMonth(current, -1);
    const futureMonth = shiftedMonth(current, 1);
    const selectedDates = [1, 2, 3, 4].map(
      (day) => `${payoutMonth.value}-${String(day).padStart(2, "0")}`,
    );
    const offDate = `${payoutMonth.value}-05`;
    const futureRecordDate = `${futureMonth.value}-01`;
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;
    const tokens = {
      teacher: "life-teacher-token",
      otherTeacher: "life-other-teacher-token",
      tooth: "life-tooth-token",
      milk: "life-milk-token",
      meal: "life-meal-token",
      ordinary: "life-ordinary-token",
      otherStudent: "life-other-student-token",
    };

    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES
        ('teacher-life', 'life@test.local', 'hash', 'active', 1,
         'invite_verified', 1, 'school-life', 1, 1),
        ('teacher-other', 'life-other@test.local', 'hash', 'active', 1,
         'invite_verified', 1, 'school-other', 1, 1);

      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, display_name, status, created_at, updated_at
      ) VALUES
        ('class-life', 'teacher-life', '생활초', '생활초', ${current.year},
         5, 1, '생활반', 'active', 1, 1),
        ('class-other', 'teacher-other', '다른초', '다른초', ${current.year},
         5, 2, '다른반', 'active', 1, 1);

      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-tooth', 'class-life', 1, '양치담당', 'active', 1, 1),
        ('student-milk', 'class-life', 2, '우유담당', 'active', 1, 1),
        ('student-meal', 'class-life', 3, '급식담당', 'active', 1, 1),
        ('student-ordinary', 'class-life', 4, '일반학생', 'active', 1, 1),
        ('student-other', 'class-other', 1, '다른학생', 'active', 1, 1);

      INSERT OR IGNORE INTO job_templates (
        id, name, short_description, detailed_tasks, category,
        recommended_min_members, recommended_max_members,
        icon_key, default_priority, is_active
      ) VALUES
        ('routine-checker', '양치 확인원', '양치 확인', '양치 확인', '생활', 1, 2, 'check', 1, 1),
        ('milk-manager', '우유 확인원', '우유 확인', '우유 확인', '생활', 1, 2, 'milk', 2, 1),
        ('meal-checker', '급식 확인원', '급식 확인', '급식 확인', '생활', 1, 2, 'meal', 3, 1);

      INSERT INTO class_jobs (
        id, class_id, template_id, name, description, member_capacity,
        category, source, sort_order, is_active, created_at, updated_at
      ) VALUES
        ('job-tooth', 'class-life', 'routine-checker', '양치 확인원', '양치 확인', 1,
         '생활', 'template', 1, 1, 1, 1),
        ('job-milk', 'class-life', 'milk-manager', '우유 확인원', '우유 확인', 1,
         '생활', 'template', 2, 1, 1, 1),
        ('job-meal', 'class-life', 'meal-checker', '급식 확인원', '급식 확인', 1,
         '생활', 'template', 3, 1, 1, 1);

      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        mode, status, confirmed_at, confirmed_by_teacher_id,
        revision, created_at, updated_at
      ) VALUES (
        'period-life', 'class-life', ${current.year}, ${current.month}, 'monthly',
        'manual', 'confirmed', 1, 'teacher-life', 1, 1, 1
      );

      INSERT INTO student_job_assignments (
        id, period_id, class_id, class_job_id, student_id,
        assignment_method, assignment_sequence, assigned_at, created_at
      ) VALUES
        ('assignment-tooth', 'period-life', 'class-life', 'job-tooth',
         'student-tooth', 'manual', 1, 1, 1),
        ('assignment-milk', 'period-life', 'class-life', 'job-milk',
         'student-milk', 'manual', 2, 1, 1),
        ('assignment-meal', 'period-life', 'class-life', 'job-meal',
         'student-meal', 'manual', 3, 1, 1);

      INSERT INTO class_calendars (
        class_id, school_year, time_zone, class_start_date,
        first_job_start_date, first_job_end_date, revision, saved_at, updated_at
      ) VALUES (
        'class-life', ${current.year}, 'Asia/Seoul', '${selectedDates[0]}',
        '${selectedDates[0]}', '${selectedDates[3]}', 1, 1, 1
      );
      INSERT INTO class_calendar_days (
        id, class_id, calendar_date, day_type, memo, created_at, updated_at
      ) VALUES
        ${calendarRows("class-life", payoutMonth.value)},
        ('calendar-class-life-future', 'class-life', '${futureRecordDate}', 'class', NULL, 1, 1);

      INSERT INTO sessions (
        id, token_hash, actor_type, teacher_id, student_id,
        expires_at, created_at, last_seen_at
      ) VALUES
        ('session-life-teacher', '${tokenHash(tokens.teacher)}', 'teacher',
         'teacher-life', NULL, ${expiresAt}, ${now}, ${now}),
        ('session-life-other-teacher', '${tokenHash(tokens.otherTeacher)}', 'teacher',
         'teacher-other', NULL, ${expiresAt}, ${now}, ${now}),
        ('session-life-tooth', '${tokenHash(tokens.tooth)}', 'student',
         NULL, 'student-tooth', ${expiresAt}, ${now}, ${now}),
        ('session-life-milk', '${tokenHash(tokens.milk)}', 'student',
         NULL, 'student-milk', ${expiresAt}, ${now}, ${now}),
        ('session-life-meal', '${tokenHash(tokens.meal)}', 'student',
         NULL, 'student-meal', ${expiresAt}, ${now}, ${now}),
        ('session-life-ordinary', '${tokenHash(tokens.ordinary)}', 'student',
         NULL, 'student-ordinary', ${expiresAt}, ${now}, ${now}),
        ('session-life-other-student', '${tokenHash(tokens.otherStudent)}', 'student',
         NULL, 'student-other', ${expiresAt}, ${now}, ${now});
    `);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: configPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });

    const missingClass = await call(worker, tokens.teacher, "/overview?type=tooth");
    assert.equal(missingClass.response.status, 400);
    assert.equal(missingClass.body.code, "LIFE_CHECK_CLASS_REQUIRED");

    const otherTeacher = await call(
      worker,
      tokens.otherTeacher,
      "/overview?classId=class-life&type=tooth",
    );
    assert.equal(otherTeacher.response.status, 404);

    const crossClassStudent = await call(
      worker,
      tokens.otherStudent,
      "/overview?classId=class-life&type=tooth",
    );
    assert.equal(crossClassStudent.response.status, 403);
    assert.equal(crossClassStudent.body.code, "LIFE_CHECK_CLASS_ACCESS_DENIED");

    const checkerOverview = await call(worker, tokens.tooth, `/overview?type=tooth&period=first&month=${payoutMonth.value}`);
    assert.equal(checkerOverview.response.status, 200);
    assert.equal(checkerOverview.body.context.role, "checker");
    assert.equal(checkerOverview.body.students.length, 4);
    assert.deepEqual(checkerOverview.body.calendar.dates, selectedDates.slice(0, 2));

    const otherTypeOverview = await call(
      worker,
      tokens.tooth,
      `/overview?type=milk&period=first&month=${payoutMonth.value}`,
    );
    assert.equal(otherTypeOverview.response.status, 200);
    assert.equal(otherTypeOverview.body.context.permissions.canViewClass, false);
    assert.deepEqual(otherTypeOverview.body.students.map((student) => student.id), ["student-tooth"]);
    assert.deepEqual(otherTypeOverview.body.recentEvents, []);

    const ordinaryBefore = await call(worker, tokens.ordinary, `/overview?type=tooth&period=first&month=${payoutMonth.value}`);
    assert.equal(ordinaryBefore.response.status, 200);
    assert.equal(ordinaryBefore.body.context.role, "student");
    assert.deepEqual(ordinaryBefore.body.students.map((student) => student.id), ["student-ordinary"]);
    assert.deepEqual(ordinaryBefore.body.recentEvents, []);

    const wrongJob = await call(worker, tokens.tooth, "/record", {
      method: "PUT",
      body: body({
        type: "milk", date: selectedDates[0], studentId: "student-ordinary",
        passed: true, expectedRevision: 0, requestId: "wrong-job-1",
      }),
    });
    assert.equal(wrongJob.response.status, 403);
    assert.equal(wrongJob.body.code, "LIFE_CHECK_WRITE_FORBIDDEN");

    const setRecord = (token, payload) => call(worker, token, "/record", {
      method: "PUT",
      body: body(payload),
    });
    const firstRecordPayload = {
      type: "tooth", date: selectedDates[0], studentId: "student-ordinary",
      passed: true, reason: "확인", expectedRevision: 0, requestId: "tooth-record-1",
    };
    const firstRecord = await setRecord(tokens.tooth, firstRecordPayload);
    assert.equal(firstRecord.response.status, 200);
    assert.deepEqual(firstRecord.body, { duplicate: false, revision: 1 });
    const firstReplay = await setRecord(tokens.tooth, firstRecordPayload);
    assert.equal(firstReplay.response.status, 200);
    assert.deepEqual(firstReplay.body, { duplicate: true, revision: 1 });

    const recordRevisionMismatch = await setRecord(tokens.tooth, {
      ...firstRecordPayload,
      expectedRevision: 1,
    });
    assert.equal(recordRevisionMismatch.response.status, 409);
    assert.equal(recordRevisionMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const idempotencyMismatch = await setRecord(tokens.tooth, {
      ...firstRecordPayload,
      passed: false,
    });
    assert.equal(idempotencyMismatch.response.status, 409);
    assert.equal(idempotencyMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const staleRecord = await setRecord(tokens.tooth, {
      ...firstRecordPayload,
      requestId: "tooth-record-stale",
    });
    assert.equal(staleRecord.response.status, 409);
    assert.equal(staleRecord.body.code, "LIFE_CHECK_STALE");

    const recordInputs = [
      [selectedDates[1], "student-ordinary", 1, "tooth-record-2"],
      [selectedDates[0], "student-tooth", 2, "tooth-record-3"],
      [selectedDates[1], "student-tooth", 3, "tooth-record-4"],
    ];
    for (const [date, studentId, expectedRevision, requestId] of recordInputs) {
      const result = await setRecord(tokens.tooth, {
        type: "tooth", date, studentId, passed: true,
        expectedRevision, requestId,
      });
      assert.equal(result.response.status, 200);
    }

    const offDay = await setRecord(tokens.tooth, {
      type: "tooth", date: offDate, studentId: "student-ordinary",
      passed: true, expectedRevision: 4, requestId: "tooth-off-day",
    });
    assert.equal(offDay.response.status, 422);
    assert.equal(offDay.body.code, "LIFE_CHECK_NOT_CLASS_DAY");

    const futureRecord = await setRecord(tokens.tooth, {
      type: "tooth", date: futureRecordDate, studentId: "student-ordinary",
      passed: true, expectedRevision: 4, requestId: "tooth-future-date",
    });
    assert.equal(futureRecord.response.status, 422);
    assert.equal(futureRecord.body.code, "LIFE_CHECK_FUTURE_DATE");

    const futurePayout = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body({
        type: "tooth", month: futureMonth.value, period: "first",
        expectedSeriesRevision: 4, expectedCalendarRevision: 1,
        expectedPayoutRevision: 0, requestId: "tooth-future-payout",
      }),
    });
    assert.equal(futurePayout.response.status, 422);
    assert.equal(futurePayout.body.code, "LIFE_CHECK_PERIOD_IN_PROGRESS");

    const financeBefore = lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions WHERE class_id = 'class-life') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries WHERE class_id = 'class-life') AS ledger_count,
         COALESCE((SELECT SUM(balance) FROM finance_accounts WHERE class_id = 'class-life'), 0) AS balance_sum;`,
    ));

    const preparePayload = {
      type: "tooth", month: payoutMonth.value, period: "first",
      expectedSeriesRevision: 4, expectedCalendarRevision: 1,
      expectedPayoutRevision: 0,
      requestId: "tooth-payout-prepare",
    };
    const prepared = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body(preparePayload),
    });
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.body.duplicate, false);
    assert.equal(prepared.body.recipientCount, 2);
    assert.equal(prepared.body.totalAmount, 200);
    const payoutId = prepared.body.payoutId;

    const prepareReplay = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body(preparePayload),
    });
    assert.equal(prepareReplay.response.status, 200);
    assert.equal(prepareReplay.body.duplicate, true);
    assert.equal(prepareReplay.body.payoutId, payoutId);

    const prepareRevisionMismatch = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body({ ...preparePayload, expectedPayoutRevision: 1 }),
    });
    assert.equal(prepareRevisionMismatch.response.status, 409);
    assert.equal(prepareRevisionMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const prepareMismatch = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body({ ...preparePayload, period: "second" }),
    });
    assert.equal(prepareMismatch.response.status, 409);
    assert.equal(prepareMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const ordinaryWithPayout = await call(
      worker,
      tokens.ordinary,
      `/overview?type=tooth&period=first&month=${payoutMonth.value}`,
    );
    assert.equal(ordinaryWithPayout.response.status, 200);
    assert.deepEqual(ordinaryWithPayout.body.students.map((student) => student.id), ["student-ordinary"]);
    assert.deepEqual(
      ordinaryWithPayout.body.payout.items.map((item) => item.studentId),
      ["student-ordinary"],
    );
    assert.equal(ordinaryWithPayout.body.payout.recipientCount, 1);
    assert.equal(ordinaryWithPayout.body.payout.totalAmount, 100);
    assert.deepEqual(ordinaryWithPayout.body.recentEvents, []);

    const completePayload = {
      action: "complete", expectedRevision: 1, requestId: "tooth-payout-complete",
    };
    const completed = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body(completePayload),
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.revision, 2);

    const completeReplay = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body(completePayload),
    });
    assert.equal(completeReplay.response.status, 200);
    assert.equal(completeReplay.body.duplicate, true);
    assert.equal(completeReplay.body.revision, 2);

    const completeRevisionMismatch = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body({ ...completePayload, expectedRevision: 2 }),
    });
    assert.equal(completeRevisionMismatch.response.status, 409);
    assert.equal(completeRevisionMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const completeMismatch = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body({
        action: "cancel", reason: "다른 작업", expectedRevision: 2,
        requestId: "tooth-payout-complete",
      }),
    });
    assert.equal(completeMismatch.response.status, 409);
    assert.equal(completeMismatch.body.code, "LIFE_CHECK_IDEMPOTENCY_CONFLICT");

    const checkerReopen = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body({
        action: "reopen", reason: "담당 학생 재개 시도", expectedRevision: 2,
        requestId: "tooth-payout-reopen-checker",
      }),
    });
    assert.equal(checkerReopen.response.status, 403);
    assert.equal(checkerReopen.body.code, "LIFE_CHECK_OVERRIDE_REQUIRED");

    const reopened = await call(
      worker,
      tokens.teacher,
      `/payout/${payoutId}?classId=class-life`,
      {
        method: "PATCH",
        body: body({
          action: "reopen", reason: "교사 비상 정정", expectedRevision: 2,
          requestId: "tooth-payout-reopen-teacher",
        }),
      },
    );
    assert.equal(reopened.response.status, 200);
    assert.equal(reopened.body.status, "prepared");
    assert.equal(reopened.body.revision, 3);

    const cancelled = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body({
        action: "cancel", reason: "명단 다시 확인", expectedRevision: 3,
        requestId: "tooth-payout-cancel",
      }),
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.revision, 4);

    const cancelledPrepare = await call(worker, tokens.tooth, "/payout", {
      method: "POST",
      body: body({
        ...preparePayload,
        expectedPayoutRevision: 4,
        requestId: "tooth-cancelled-prepare",
      }),
    });
    assert.equal(cancelledPrepare.response.status, 409);
    assert.equal(cancelledPrepare.body.code, "LIFE_CHECK_PAYOUT_CANCELLED");

    const reopenedCancelled = await call(
      worker,
      tokens.teacher,
      `/payout/${payoutId}?classId=class-life`,
      {
        method: "PATCH",
        body: body({
          action: "reopen", reason: "취소 명단 교사 재개", expectedRevision: 4,
          requestId: "tooth-cancelled-reopen-teacher",
        }),
      },
    );
    assert.equal(reopenedCancelled.response.status, 200);
    assert.equal(reopenedCancelled.body.status, "prepared");
    assert.equal(reopenedCancelled.body.revision, 5);

    executeSql(
      persistPath,
      "UPDATE class_calendars SET revision = 2, updated_at = 2 WHERE class_id = 'class-life';",
    );
    const calendarOutdatedComplete = await call(worker, tokens.tooth, `/payout/${payoutId}`, {
      method: "PATCH",
      body: body({
        action: "complete", expectedRevision: 5,
        requestId: "tooth-calendar-outdated-complete",
      }),
    });
    assert.equal(calendarOutdatedComplete.response.status, 409);
    assert.equal(calendarOutdatedComplete.body.code, "LIFE_CHECK_PAYOUT_OUTDATED");

    const teacherAudit = await call(
      worker,
      tokens.teacher,
      `/overview?classId=class-life&type=tooth&period=first&month=${payoutMonth.value}`,
    );
    assert.equal(teacherAudit.response.status, 200);
    const payoutActions = teacherAudit.body.recentEvents
      .filter((event) => event.kind === "payout")
      .map((event) => event.action);
    assert.ok(payoutActions.includes("prepared"));
    assert.ok(payoutActions.includes("completed"));
    assert.ok(payoutActions.includes("cancelled"));
    assert.ok(payoutActions.includes("reopened"));
    assert.ok(teacherAudit.body.recentEvents.some((event) => event.kind === "record"));

    const auditFirstPage = await call(
      worker,
      tokens.teacher,
      "/audit?classId=class-life&type=tooth&limit=3",
    );
    assert.equal(auditFirstPage.response.status, 200);
    assert.equal(auditFirstPage.body.events.length, 3);
    assert.equal(auditFirstPage.body.hasMore, true);
    assert.equal(typeof auditFirstPage.body.nextCursor, "string");
    const auditSecondPage = await call(
      worker,
      tokens.teacher,
      `/audit?classId=class-life&type=tooth&limit=3&cursor=${encodeURIComponent(auditFirstPage.body.nextCursor)}`,
    );
    assert.equal(auditSecondPage.response.status, 200);
    const firstKeys = new Set(
      auditFirstPage.body.events.map((event) => `${event.kind}:${event.id}`),
    );
    assert.equal(
      auditSecondPage.body.events.some((event) => firstKeys.has(`${event.kind}:${event.id}`)),
      false,
    );
    const combinedEvents = [
      ...auditFirstPage.body.events,
      ...auditSecondPage.body.events,
    ];
    assert.deepEqual(
      combinedEvents.map((event) => [event.createdAt, `${event.kind}:${event.id}`]),
      [...combinedEvents]
        .sort((left, right) => (
          right.createdAt - left.createdAt
          || `${right.kind}:${right.id}`.localeCompare(`${left.kind}:${left.id}`)
        ))
        .map((event) => [event.createdAt, `${event.kind}:${event.id}`]),
    );

    const crossTypeCursor = await call(
      worker,
      tokens.teacher,
      `/audit?classId=class-life&type=milk&limit=3&cursor=${encodeURIComponent(auditFirstPage.body.nextCursor)}`,
    );
    assert.equal(crossTypeCursor.response.status, 400);
    assert.equal(crossTypeCursor.body.code, "AUDIT_HISTORY_INVALID_CURSOR");
    const crossUserCursor = await call(
      worker,
      tokens.tooth,
      `/audit?type=tooth&limit=3&cursor=${encodeURIComponent(auditFirstPage.body.nextCursor)}`,
    );
    assert.equal(crossUserCursor.response.status, 400);
    assert.equal(crossUserCursor.body.code, "AUDIT_HISTORY_INVALID_CURSOR");
    const ordinaryAudit = await call(worker, tokens.ordinary, "/audit?type=tooth");
    assert.equal(ordinaryAudit.response.status, 403);
    assert.equal(ordinaryAudit.body.code, "LIFE_CHECK_AUDIT_FORBIDDEN");
    const otherTeacherAudit = await call(
      worker,
      tokens.otherTeacher,
      "/audit?classId=class-life&type=tooth",
    );
    assert.equal(otherTeacherAudit.response.status, 404);

    executeSql(
      persistPath,
      Array.from({ length: 7 }, (_, index) => `
        INSERT INTO mart_operations (
          id, class_id, idempotency_key, operation, resource_id, payload_hash,
          actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
          actor_label, intervention_reason, expected_class_revision, created_at
        ) VALUES (
          'mart-audit-${index}', 'class-life', 'mart:audit:test:${index}',
          'product_create', 'mart-resource-${index}', 'hash-${index}',
          'teacher', 'teacher-life', NULL, NULL, '교사', NULL, ${index}, 123456
        );
      `).join("\n"),
    );
    const martAuditFirst = await call(
      worker,
      tokens.teacher,
      "/mart-audit?classId=class-life&limit=3",
    );
    assert.equal(martAuditFirst.response.status, 200);
    assert.deepEqual(
      martAuditFirst.body.events.map((event) => event.id),
      ["mart-audit-6", "mart-audit-5", "mart-audit-4"],
    );
    assert.deepEqual(
      Object.keys(martAuditFirst.body.events[0].actor).sort(),
      ["label", "type"],
      "감사 응답은 내부 교사·학생·직업배정 ID를 노출하지 않습니다.",
    );
    assert.equal(martAuditFirst.body.hasMore, true);
    const martAuditSecond = await call(
      worker,
      tokens.teacher,
      `/mart-audit?classId=class-life&limit=3&cursor=${encodeURIComponent(martAuditFirst.body.nextCursor)}`,
    );
    assert.equal(martAuditSecond.response.status, 200);
    assert.deepEqual(
      martAuditSecond.body.events.map((event) => event.id),
      ["mart-audit-3", "mart-audit-2", "mart-audit-1"],
    );
    const martCursorOtherClass = await call(
      worker,
      tokens.otherTeacher,
      `/mart-audit?classId=class-other&limit=3&cursor=${encodeURIComponent(martAuditFirst.body.nextCursor)}`,
    );
    assert.equal(martCursorOtherClass.response.status, 400);
    assert.equal(martCursorOtherClass.body.code, "AUDIT_HISTORY_INVALID_CURSOR");
    const martAuditOrdinary = await call(worker, tokens.ordinary, "/mart-audit");
    assert.equal(martAuditOrdinary.response.status, 403);
    assert.equal(martAuditOrdinary.body.code, "MART_AUDIT_ACCESS_DENIED");

    let milkRevision = 0;
    for (const [date, studentId] of [
      [selectedDates[0], "student-ordinary"],
      [selectedDates[1], "student-ordinary"],
      [selectedDates[0], "student-milk"],
      [selectedDates[1], "student-milk"],
    ]) {
      const result = await setRecord(tokens.milk, {
        type: "milk", date, studentId, passed: true,
        expectedRevision: milkRevision, requestId: `milk-record-${milkRevision + 1}`,
      });
      assert.equal(result.response.status, 200);
      milkRevision += 1;
    }
    const milkPrepared = await call(worker, tokens.milk, "/payout", {
      method: "POST",
      body: body({
        type: "milk", month: payoutMonth.value, period: "first",
        expectedSeriesRevision: milkRevision, expectedCalendarRevision: 2,
        expectedPayoutRevision: 0,
        requestId: "milk-payout-prepare",
      }),
    });
    assert.equal(milkPrepared.response.status, 200);

    const changedAfterPrepare = await setRecord(tokens.milk, {
      type: "milk", date: selectedDates[0], studentId: "student-ordinary",
      passed: false, expectedRevision: milkRevision, requestId: "milk-record-change",
    });
    assert.equal(changedAfterPrepare.response.status, 200);

    const outdatedComplete = await call(
      worker,
      tokens.milk,
      `/payout/${milkPrepared.body.payoutId}`,
      {
        method: "PATCH",
        body: body({
          action: "complete", expectedRevision: 1,
          requestId: "milk-payout-outdated-complete",
        }),
      },
    );
    assert.equal(outdatedComplete.response.status, 409);
    assert.equal(outdatedComplete.body.code, "LIFE_CHECK_PAYOUT_OUTDATED");

    const financeAfter = lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions WHERE class_id = 'class-life') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries WHERE class_id = 'class-life') AS ledger_count,
         COALESCE((SELECT SUM(balance) FROM finance_accounts WHERE class_id = 'class-life'), 0) AS balance_sum;`,
    ));
    assert.deepEqual(financeAfter, financeBefore, "생활확인 지급 명단은 금융 원장을 변경하면 안 된다");

    const crossClassInsert = executeSql(persistPath, `
      INSERT INTO life_check_records (
        id, class_id, check_type, check_date, student_id, passed, revision,
        last_actor_type, last_actor_teacher_id, last_actor_student_id,
        created_at, updated_at
      ) VALUES (
        'malicious-cross-class', 'class-life', 'lunch', '${selectedDates[0]}',
        'student-other', 1, 1, 'teacher', 'teacher-life', NULL, 999, 999
      );
    `, { expectSuccess: false });
    assert.match(crossClassInsert.output, /LIFE_CHECK_RECORD_SCOPE_DENIED/);

    const wrongJobDirectRecord = executeSql(persistPath, `
      INSERT INTO life_check_records (
        id, class_id, check_type, check_date, student_id, passed, revision,
        last_actor_type, last_actor_teacher_id, last_actor_student_id,
        created_at, updated_at
      ) VALUES (
        'malicious-wrong-job-record', 'class-life', 'milk', '${selectedDates[0]}',
        'student-meal', 1, 1, 'checker', NULL, 'student-tooth', 1000, 1000
      );
    `, { expectSuccess: false });
    assert.match(wrongJobDirectRecord.output, /LIFE_CHECK_RECORD_SCOPE_DENIED/);

    const wrongJobDirectPayout = executeSql(persistPath, `
      INSERT INTO life_check_payouts (
        id, class_id, check_type, payout_year, payout_month, payout_period,
        status, items_json, recipient_count, total_amount,
        source_series_revision, source_calendar_revision, revision,
        created_by_actor_type, created_by_teacher_id, created_by_student_id,
        last_actor_type, last_actor_teacher_id, last_actor_student_id,
        created_at, updated_at
      ) VALUES (
        'malicious-wrong-job-payout', 'class-life', 'milk',
        ${payoutMonth.year}, ${payoutMonth.month}, 'second', 'prepared',
        '[{"studentId":"student-ordinary","studentNumber":4,"studentName":"일반학생","passedCount":2,"totalCount":2,"baseAmount":100,"bonusAmount":0,"amount":100,"reason":"검증"}]',
        1, 100, ${milkRevision + 1}, 2, 1,
        'checker', NULL, 'student-tooth', 'checker', NULL, 'student-tooth',
        1000, 1000
      );
    `, { expectSuccess: false });
    assert.match(wrongJobDirectPayout.output, /LIFE_CHECK_PAYOUT_STATE_INVALID/);

    const immutableEvent = executeSql(
      persistPath,
      "UPDATE life_check_events SET reason = '변조' WHERE request_id = 'tooth-record-1';",
      { expectSuccess: false },
    );
    assert.match(immutableEvent.output, /LIFE_CHECK_EVENT_IMMUTABLE/);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT action, json_array_length(json_extract(detail, '$.items')) AS item_count
       FROM life_check_payout_events
       WHERE class_id = 'class-life'
         AND request_id IN ('tooth-payout-prepare', 'tooth-payout-complete')
       ORDER BY action;`,
    )), [
      { action: "completed", item_count: 2 },
      { action: "prepared", item_count: 2 },
    ]);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM life_check_events
          WHERE class_id = 'class-life' AND request_id = 'tooth-record-1') AS record_event_count,
         (SELECT COUNT(*) FROM life_check_payout_events
          WHERE class_id = 'class-life' AND request_id = 'tooth-payout-prepare') AS payout_event_count;`,
    )), [{ record_event_count: 1, payout_event_count: 1 }]);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

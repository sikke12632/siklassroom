import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `wrangler 명령이 실패했습니다.\n${output.slice(-5000)}`,
    );
  } else {
    assert.notEqual(result.status, 0, "실패해야 하는 D1 명령이 성공했습니다.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, options) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ], options);
  if (result.status !== 0) return result;
  return {
    ...result,
    data: JSON.parse(result.stdout),
  };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

test("학급 화폐 설정과 변경 이력은 D1에서 동시성·권한·운영 중지를 강제한다", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-settings-d1-"),
  );
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(
      persistPath,
      `
        INSERT INTO teachers (
          id, email, password_hash, status, created_at, updated_at
        ) VALUES
          ('teacher-settings', 'settings@test.local', 'hash', 'active', 1, 1),
          ('teacher-other', 'other-settings@test.local', 'hash', 'active', 1, 1);
        INSERT INTO classes (
          id, teacher_id, school_name, school_normalized,
          school_year, grade, class_number, status, created_at, updated_at
        ) VALUES (
          'class-settings', 'teacher-settings', '테스트초', '테스트초',
          2099, 6, 3, 'active', 1, 1
        );
        INSERT INTO students (
          id, class_id, student_number, official_name, status,
          created_at, updated_at
        ) VALUES
          ('student-settings', 'class-settings', 1, '신청학생', 'active', 1, 1),
          ('banker-settings', 'class-settings', 2, '은행학생', 'active', 1, 1),
          ('student-settings-two', 'class-settings', 3, '둘째학생', 'active', 1, 1);
        INSERT OR IGNORE INTO job_templates (
          id, name, short_description, detailed_tasks, category,
          recommended_min_members, recommended_max_members, icon_key,
          default_priority, is_active
        ) VALUES (
          'banker', '은행원', '은행 업무', '입출금 확인',
          'economy', 1, 2, 'bank', 1, 1
        );
        INSERT INTO class_jobs (
          id, class_id, template_id, name, description, member_capacity,
          category, source, sort_order, is_active, created_at, updated_at
        ) VALUES (
          'job-settings-banker', 'class-settings', 'banker', '은행원',
          '은행 업무', 1, 'economy', 'template', 1, 1, 1, 1
        );
        INSERT INTO class_job_assignment_periods (
          id, class_id, assignment_year, assignment_month, assignment_type,
          mode, status, confirmed_at, confirmed_by_teacher_id, revision,
          created_at, updated_at
        ) VALUES (
          'period-settings', 'class-settings',
          CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
          CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
          'monthly', 'choice', 'confirmed', 2, 'teacher-settings', 1, 1, 2
        );
        INSERT INTO student_job_assignments (
          id, period_id, class_id, class_job_id, student_id,
          assignment_method, request_id, assignment_sequence,
          assigned_at, created_at
        ) VALUES (
          'assignment-settings-banker', 'period-settings', 'class-settings',
          'job-settings-banker', 'banker-settings', 'teacher',
          'assign-settings-banker', 1, 2, 2
        );
      `,
    );

    const defaults = lastResults(executeSql(
      persistPath,
      `SELECT currency_name, currency_unit, denominations_json,
              bank_open, max_request_amount, revision
       FROM finance_settings WHERE class_id = 'class-settings';`,
    ))[0];
    assert.deepEqual(defaults, {
      currency_name: "우리 반 화폐",
      currency_unit: "학급화폐",
      denominations_json: "[100,500,1000,5000]",
      bank_open: 1,
      max_request_amount: 100000,
      revision: 0,
    });

    executeSql(
      persistPath,
      `
        UPDATE finance_settings
        SET currency_name = '별빛 화폐', currency_unit = '별',
            denominations_json = '[100,500,1000]',
            max_request_amount = 5000, revision = 1,
            updated_by_teacher_id = 'teacher-settings', updated_at = 10
        WHERE class_id = 'class-settings' AND revision = 0;
        INSERT INTO finance_setting_revisions (
          id, class_id, revision, idempotency_key, payload_hash,
          previous_settings_json, settings_json, change_reason,
          actor_teacher_id, actor_label, created_at
        ) VALUES (
          'settings-rev-1', 'class-settings', 1, 'settings:update:one',
          'hash-1', '{"currencyUnit":"학급화폐"}', '{"currencyUnit":"별"}',
          '학급 회의에서 변경', 'teacher-settings', '교사', 10
        );
      `,
    );

    const stale = executeSql(
      persistPath,
      `UPDATE finance_settings
       SET revision = 1, updated_by_teacher_id = 'teacher-settings', updated_at = 11
       WHERE class_id = 'class-settings';`,
      { expectSuccess: false },
    );
    assert.match(stale.output, /FINANCE_SETTINGS_STALE/);

    const otherTeacher = executeSql(
      persistPath,
      `UPDATE finance_settings
       SET revision = 2, updated_by_teacher_id = 'teacher-other', updated_at = 12
       WHERE class_id = 'class-settings';`,
      { expectSuccess: false },
    );
    assert.match(otherTeacher.output, /FINANCE_SETTINGS_ACCESS_DENIED/);

    const immutable = executeSql(
      persistPath,
      `UPDATE finance_setting_revisions
       SET change_reason = '바꿈' WHERE id = 'settings-rev-1';`,
      { expectSuccess: false },
    );
    assert.match(immutable.output, /FINANCE_SETTINGS_REVISION_IMMUTABLE/);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, memo, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'cash-settings-open', 'class-settings', 'student-settings',
          'finance:student:student-settings:wallet', 'deposit', 1000, NULL,
          'cash:settings:open', 'cash-hash-open', 1, '신청학생', 0, 0, 0, 20
        ), (
          'cash-settings-approve', 'class-settings', 'student-settings-two',
          'finance:student:student-settings-two:wallet', 'deposit', 1000, NULL,
          'cash:settings:approve', 'cash-hash-approve', 3, '둘째학생', 0, 0, 0, 20
        );
        UPDATE finance_settings
        SET bank_open = 0, banker_processing_enabled = 0,
            revision = 2, updated_by_teacher_id = 'teacher-settings',
            updated_at = 21
        WHERE class_id = 'class-settings' AND revision = 1;
        INSERT INTO finance_setting_revisions (
          id, class_id, revision, idempotency_key, payload_hash,
          previous_settings_json, settings_json, change_reason,
          actor_teacher_id, actor_label, created_at
        ) VALUES (
          'settings-rev-2', 'class-settings', 2, 'settings:update:two',
          'hash-2', '{"bankOpen":true}', '{"bankOpen":false}',
          '오늘 은행 운영 종료', 'teacher-settings', '교사', 21
        );
      `,
    );

    const closedRequest = executeSql(
      persistPath,
      `INSERT INTO finance_cash_requests (
         id, class_id, requester_student_id, wallet_account_id,
         request_type, amount, memo, idempotency_key, payload_hash,
         student_number_snapshot, student_name_snapshot,
         wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
       ) VALUES (
         'cash-settings-closed', 'class-settings', 'student-settings',
         'finance:student:student-settings:wallet', 'deposit', 100, NULL,
         'cash:settings:closed', 'cash-hash-closed', 1, '신청학생', 0, 0, 0, 22
       );`,
      { expectSuccess: false },
    );
    assert.match(closedRequest.output, /FINANCE_BANK_CLOSED/);

    const bankerDecision = executeSql(
      persistPath,
      `INSERT INTO finance_request_resolutions (
         id, request_id, class_id, decision, idempotency_key, payload_hash,
         expected_request_revision, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label,
         reason_code, reason_note, intervention_reason, is_emergency,
         posted_transaction_id, transaction_payload_hash, resolved_at, created_at
       ) VALUES (
         'resolution-settings', 'cash-settings-open', 'class-settings',
         'rejected', 'resolution:settings:closed', 'resolution-hash', 0,
         'banker', NULL, 'banker-settings', 'period-settings', '은행학생',
         'amount_check', NULL, NULL, 0, NULL, NULL, 23, 23
       );`,
      { expectSuccess: false },
    );
    assert.match(bankerDecision.output, /FINANCE_BANK_CLOSED/);

    executeSql(
      persistPath,
      `
        UPDATE finance_settings
        SET bank_open = 1, banker_processing_enabled = 1,
            deposit_enabled = 0, max_request_amount = 100,
            revision = 3, updated_by_teacher_id = 'teacher-settings',
            updated_at = 24
        WHERE class_id = 'class-settings' AND revision = 2;
        INSERT INTO finance_setting_revisions (
          id, class_id, revision, idempotency_key, payload_hash,
          previous_settings_json, settings_json, change_reason,
          actor_teacher_id, actor_label, created_at
        ) VALUES (
          'settings-rev-3', 'class-settings', 3, 'settings:update:three',
          'hash-3', '{"depositEnabled":true,"maxRequestAmount":5000}',
          '{"depositEnabled":false,"maxRequestAmount":100}',
          '입금 신청 잠시 중지', 'teacher-settings', '교사', 24
        );
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_teacher_id,
          actor_student_id, actor_job_period_id, actor_label,
          reason_code, reason_note, intervention_reason, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-settings-reject', 'cash-settings-open', 'class-settings',
          'rejected', 'resolution:settings:reject', 'resolution-reject-hash', 0,
          'banker', NULL, 'banker-settings', 'period-settings', '은행학생',
          'amount_check', NULL, NULL, 0, NULL, NULL, 25, 25
        );
      `,
    );

    const blockedApproval = executeSql(
      persistPath,
      `INSERT INTO finance_request_resolutions (
         id, request_id, class_id, decision, idempotency_key, payload_hash,
         expected_request_revision, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label,
         reason_code, reason_note, intervention_reason, is_emergency,
         posted_transaction_id, transaction_payload_hash, resolved_at, created_at
       ) VALUES (
         'resolution-settings-approve', 'cash-settings-approve', 'class-settings',
         'approved', 'resolution:settings:approve', 'resolution-approve-hash', 0,
         'banker', NULL, 'banker-settings', 'period-settings', '은행학생',
         NULL, NULL, NULL, 0, 'transaction-settings-approve',
         'transaction-settings-hash', 26, 26
       );`,
      { expectSuccess: false },
    );
    assert.match(blockedApproval.output, /FINANCE_DEPOSIT_DISABLED/);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

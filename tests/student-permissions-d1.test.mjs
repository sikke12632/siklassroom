import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 30 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(result.status, 0, output.slice(-6000));
  } else {
    assert.notEqual(result.status, 0, "실패해야 하는 D1 명령이 성공했습니다.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, options) {
  const result = runWrangler([
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
  ], options);
  if (result.status !== 0) return result;
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

test("직업 배정이 없어도 교사 직접 권한은 은행·마트·생활확인에서 즉시 적용되고 해제된다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-student-permissions-"));
  try {
    runWrangler([
      "d1", "migrations", "apply", "DB", "--local", `--persist-to=${persistPath}`,
    ]);
    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-permission', 'permission@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-permission', 'teacher-permission', '권한초', '권한초', 2098,
        5, 7, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('operator-permission', 'class-permission', 1, '운영학생', 'active', 1, 1),
        ('target-permission', 'class-permission', 2, '기록대상', 'active', 1, 1);
      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        mode, status, confirmed_at, confirmed_by_teacher_id, revision,
        created_at, updated_at
      ) VALUES (
        'student-permission-period:class-permission', 'class-permission', 2098, 1,
        'permission', 'manual_permission', 'confirmed', 2,
        'teacher-permission', 0, 2, 2
      );
      INSERT INTO student_manual_permissions (
        id, class_id, student_id, permission_key, is_active,
        granted_by_teacher_id, revision, created_at, updated_at
      ) VALUES
        ('permission-finance', 'class-permission', 'operator-permission',
         'finance_banker', 1, 'teacher-permission', 1, 2, 2),
        ('permission-mart', 'class-permission', 'operator-permission',
         'mart_operator', 1, 'teacher-permission', 1, 2, 2),
        ('permission-tooth', 'class-permission', 'operator-permission',
         'life_check_tooth', 1, 'teacher-permission', 1, 2, 2);
      INSERT INTO audit_logs (
        id, teacher_id, class_id, student_id, action, detail, created_at
      ) VALUES
        ('audit-finance-grant', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_granted',
         '{"permissionKey":"finance_banker","enabled":true,"revision":1}', 2),
        ('audit-mart-grant', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_granted',
         '{"permissionKey":"mart_operator","enabled":true,"revision":1}', 2),
        ('audit-tooth-grant', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_granted',
         '{"permissionKey":"life_check_tooth","enabled":true,"revision":1}', 2);
    `);

    const effective = lastResults(executeSql(persistPath, `
      SELECT permission_key, period_id, permission_source
      FROM student_effective_permissions
      WHERE student_id = 'operator-permission'
      ORDER BY permission_key;
    `));
    assert.deepEqual(effective, [
      { permission_key: "finance_banker", period_id: "student-permission-period:class-permission", permission_source: "manual" },
      { permission_key: "life_check_tooth", period_id: "student-permission-period:class-permission", permission_source: "manual" },
      { permission_key: "mart_operator", period_id: "student-permission-period:class-permission", permission_source: "manual" },
    ]);
    assert.equal(lastResults(executeSql(persistPath, `
      SELECT COUNT(*) AS count FROM student_job_assignments;
    `))[0].count, 0);

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'manual-mart-operation', 'class-permission', 'manual:mart:operation',
        'product_create', 'manual-product', 'hash', 'market_clerk', NULL,
        'operator-permission', 'student-permission-period:class-permission',
        '운영학생', NULL, 0, 3
      );
      INSERT INTO life_check_records (
        id, class_id, check_type, check_date, student_id, passed, revision,
        last_actor_type, last_actor_teacher_id, last_actor_student_id,
        created_at, updated_at
      ) VALUES (
        'manual-life-record', 'class-permission', 'tooth', '2098-03-02',
        'target-permission', 1, 1, 'checker', NULL, 'operator-permission', 3, 3
      );
    `);

    // 이 테스트에서는 금융 actor guard만 독립적으로 확인한다. 현금 신청과
    // 해결 트랜잭션의 결합 무결성은 기존 finance-operations D1 테스트가 맡는다.
    executeSql(persistPath, `DROP TRIGGER finance_transactions_cash_request_scope_guard;`);
    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, created_at
      ) VALUES (
        'manual-finance-transaction', 'class-permission', 'pending',
        'cash_deposit', '수동 은행 권한 검사', 'manual:finance:operation',
        'hash', 'cash_request', 'manual-request', 'banker', NULL,
        'operator-permission', 'student-permission-period:class-permission',
        '운영학생', 3
      );
    `);

    executeSql(persistPath, `
      UPDATE student_manual_permissions
      SET is_active = 0, granted_by_teacher_id = 'teacher-permission',
          revision = 2, updated_at = 4
      WHERE id IN ('permission-finance', 'permission-mart', 'permission-tooth');
      INSERT INTO audit_logs (
        id, teacher_id, class_id, student_id, action, detail, created_at
      ) VALUES
        ('audit-finance-revoke', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_revoked',
         '{"permissionKey":"finance_banker","enabled":false,"revision":2}', 4),
        ('audit-mart-revoke', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_revoked',
         '{"permissionKey":"mart_operator","enabled":false,"revision":2}', 4),
        ('audit-tooth-revoke', 'teacher-permission', 'class-permission',
         'operator-permission', 'student_manual_permission_revoked',
         '{"permissionKey":"life_check_tooth","enabled":false,"revision":2}', 4);
    `);

    const deniedMart = executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'revoked-mart-operation', 'class-permission', 'revoked:mart:operation',
        'product_create', 'revoked-product', 'hash', 'market_clerk', NULL,
        'operator-permission', 'student-permission-period:class-permission',
        '운영학생', NULL, 1, 5
      );
    `, { expectSuccess: false });
    assert.match(deniedMart.output, /MART_CLERK_ACCESS_DENIED/);

    const deniedLife = executeSql(persistPath, `
      INSERT INTO life_check_records (
        id, class_id, check_type, check_date, student_id, passed, revision,
        last_actor_type, last_actor_teacher_id, last_actor_student_id,
        created_at, updated_at
      ) VALUES (
        'revoked-life-record', 'class-permission', 'tooth', '2098-03-03',
        'target-permission', 1, 1, 'checker', NULL, 'operator-permission', 5, 5
      );
    `, { expectSuccess: false });
    assert.match(deniedLife.output, /LIFE_CHECK_RECORD_SCOPE_DENIED/);

    const deniedFinance = executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, created_at
      ) VALUES (
        'revoked-finance-transaction', 'class-permission', 'pending',
        'cash_deposit', '해제된 은행 권한 검사', 'revoked:finance:operation',
        'hash', 'cash_request', 'revoked-request', 'banker', NULL,
        'operator-permission', 'student-permission-period:class-permission',
        '운영학생', 5
      );
    `, { expectSuccess: false });
    assert.match(deniedFinance.output, /FINANCE_BANKER_ACCESS_DENIED/);

    const auditRows = lastResults(executeSql(persistPath, `
      SELECT action, json_extract(detail, '$.revision') AS revision
      FROM audit_logs
      WHERE student_id = 'operator-permission'
      ORDER BY created_at, id;
    `));
    assert.equal(auditRows.length, 6);
    assert.deepEqual([...new Set(auditRows.map((row) => row.action))].sort(), [
      "student_manual_permission_granted",
      "student_manual_permission_revoked",
    ]);
    assert.deepEqual([...new Set(auditRows.map((row) => row.revision))].sort(), [1, 2]);
    const immutableAudit = executeSql(persistPath, `
      UPDATE audit_logs SET detail = '{}' WHERE id = 'audit-finance-grant';
    `, { expectSuccess: false });
    assert.match(immutableAudit.output, /AUDIT_LOG_IMMUTABLE/);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

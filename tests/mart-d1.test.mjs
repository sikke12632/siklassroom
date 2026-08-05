import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
    assert.equal(result.status, 0, `wrangler 명령이 실패했습니다.\n${output.slice(-5000)}`);
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

test("마트 D1은 학급·직업 권한, 원자적 재고, 취소 복구와 금융 원장 격리를 강제한다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-mart-d1-"));
  try {
    runWrangler([
      "d1", "migrations", "apply", "DB", "--local", `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES
        ('teacher-mart', 'mart@test.local', 'hash', 'active', 1, 1),
        ('teacher-other-mart', 'other-mart@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES
        ('class-mart', 'teacher-mart', '테스트초', '테스트초-마트', 2099, 5, 1, 'active', 1, 1),
        ('class-other-mart', 'teacher-other-mart', '테스트초', '테스트초-다른마트', 2099, 5, 2, 'active', 1, 1);
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('clerk-mart', 'class-mart', 1, '마트직원', 'active', 1, 1),
        ('buyer-pending-mart', 'class-mart', 2, '등록전학생', 'pending', 1, 1),
        ('buyer-reset-mart', 'class-mart', 3, '재설정학생', 'reset_required', 1, 1),
        ('ordinary-mart', 'class-mart', 4, '일반학생', 'active', 1, 1),
        ('excluded-mart', 'class-mart', 5, '제외학생', 'excluded', 1, 1),
        ('clerk-other-mart', 'class-other-mart', 1, '다른반직원', 'active', 1, 1);
      INSERT OR IGNORE INTO job_templates (
        id, name, short_description, detailed_tasks, category,
        recommended_min_members, recommended_max_members, icon_key,
        default_priority, is_active
      ) VALUES (
        'market-clerk', '마트 직원', '상품 판매', '상품과 재고 관리',
        'economy', 1, 2, 'store', 1, 1
      );
      INSERT INTO class_jobs (
        id, class_id, template_id, name, description, member_capacity,
        category, source, sort_order, is_active, created_at, updated_at
      ) VALUES
        ('job-mart-clerk', 'class-mart', 'market-clerk', '마트 직원',
         '상품 판매', 1, 'economy', 'template', 1, 1, 1, 1),
        ('job-other-mart-clerk', 'class-other-mart', 'market-clerk', '마트 직원',
         '상품 판매', 1, 'economy', 'template', 1, 1, 1, 1);
      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        mode, status, confirmed_at, confirmed_by_teacher_id, revision,
        created_at, updated_at
      ) VALUES
        ('period-mart', 'class-mart',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'monthly', 'choice', 'confirmed', 2, 'teacher-mart', 1, 1, 2),
        ('period-other-mart', 'class-other-mart',
         CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
         CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
         'monthly', 'choice', 'confirmed', 2, 'teacher-other-mart', 1, 1, 2);
      INSERT INTO student_job_assignments (
        id, period_id, class_id, class_job_id, student_id,
        assignment_method, request_id, assignment_sequence, assigned_at, created_at
      ) VALUES
        ('assignment-mart-clerk', 'period-mart', 'class-mart',
         'job-mart-clerk', 'clerk-mart', 'teacher', 'assign-mart-clerk', 1, 2, 2),
        ('assignment-other-mart-clerk', 'period-other-mart', 'class-other-mart',
         'job-other-mart-clerk', 'clerk-other-mart', 'teacher',
         'assign-other-mart-clerk', 1, 2, 2);
    `);

    const financeBefore = lastResults(executeSql(
      persistPath,
      `SELECT id, balance, revision FROM finance_accounts ORDER BY id;`,
    ));

    for (const [sql, pattern] of [
      [`INSERT INTO mart_operations (
          id, class_id, idempotency_key, operation, resource_id, payload_hash,
          actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
          actor_label, intervention_reason, expected_class_revision, created_at
        ) VALUES (
          'op-wrong-teacher', 'class-mart', 'mart:wrong:teacher', 'product_create',
          'wrong-product', 'hash', 'teacher', 'teacher-other-mart', NULL, NULL,
          '다른 교사', NULL, 0, 10
        );`, /MART_CLASS_ACCESS_DENIED/],
      [`INSERT INTO mart_operations (
          id, class_id, idempotency_key, operation, resource_id, payload_hash,
          actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
          actor_label, intervention_reason, expected_class_revision, created_at
        ) VALUES (
          'op-ordinary', 'class-mart', 'mart:wrong:ordinary', 'product_create',
          'wrong-product', 'hash', 'market_clerk', NULL, 'ordinary-mart',
          'period-mart', '일반학생', NULL, 0, 10
        );`, /MART_CLERK_ACCESS_DENIED/],
      [`INSERT INTO mart_operations (
          id, class_id, idempotency_key, operation, resource_id, payload_hash,
          actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
          actor_label, intervention_reason, expected_class_revision, created_at
        ) VALUES (
          'op-other-clerk', 'class-mart', 'mart:wrong:other-clerk', 'product_create',
          'wrong-product', 'hash', 'market_clerk', NULL, 'clerk-other-mart',
          'period-other-mart', '다른반직원', NULL, 0, 10
        );`, /MART_CLERK_ACCESS_DENIED/],
      [`INSERT INTO mart_operations (
          id, class_id, idempotency_key, operation, resource_id, payload_hash,
          actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
          actor_label, intervention_reason, expected_class_revision, created_at
        ) VALUES (
          'op-clerk-correction', 'class-mart', 'mart:wrong:clerk-correction',
          'inventory_correction', 'movement-wrong-correction', 'hash-correction',
          'market_clerk', NULL, 'clerk-mart', 'period-mart', '마트직원',
          '직원이 비상 정정을 시도함', 0, 10
        );`, /MART_INVENTORY_CORRECTION_TEACHER_REQUIRED/],
    ]) {
      const denied = executeSql(persistPath, sql, { expectSuccess: false });
      assert.match(denied.output, pattern);
    }

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-product', 'class-mart', 'mart:product:create', 'product_create',
        'product-mart', 'hash-product', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', NULL, 0, 100
      );
      INSERT INTO mart_products (
        id, class_id, name, category, description, unit_price,
        low_stock_threshold, is_active, revision, created_operation_id,
        created_at, updated_at
      ) VALUES (
        'product-mart', 'class-mart', '연필', '문구', '교실 연필', 300,
        2, 1, 0, 'op-product', 100, 100
      );
      INSERT INTO mart_inventory (
        product_id, class_id, quantity, revision, created_at, updated_at
      ) VALUES ('product-mart', 'class-mart', 0, 0, 100, 100);
      INSERT INTO mart_product_events (
        id, class_id, product_id, operation_id, revision, action,
        product_snapshot_json, created_at
      ) VALUES (
        'event-product', 'class-mart', 'product-mart', 'op-product', 0,
        'created', '{"name":"연필","price":300}', 100
      );
    `);

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-inbound', 'class-mart', 'mart:inventory:inbound', 'inventory_inbound',
        'movement-inbound', 'hash-inbound', 'teacher', 'teacher-mart', NULL,
        NULL, '담임교사', NULL, 1, 200
      );
      INSERT INTO mart_inventory_movements (
        id, class_id, product_id, operation_id, movement_type, delta,
        quantity_before, quantity_after, inventory_revision_before,
        inventory_revision_after, source_sale_id, source_sale_item_id,
        reason, created_at
      ) VALUES (
        'movement-inbound', 'class-mart', 'product-mart', 'op-inbound',
        'inbound', 10, 0, 10, 0, 1, NULL, NULL, '새 물품 입고', 200
      );
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT quantity, revision FROM mart_inventory WHERE product_id = 'product-mart';`,
    )), [{ quantity: 10, revision: 1 }]);

    const stale = executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-stale', 'class-mart', 'mart:stale:context', 'inventory_inbound',
        'movement-stale', 'hash-stale', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', NULL, 1, 201
      );
    `, { expectSuccess: false });
    assert.match(stale.output, /MART_CONTEXT_STALE/);

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-sale', 'class-mart', 'mart:sale:create', 'sale_create',
        'sale-mart', 'hash-sale', 'teacher', 'teacher-mart', NULL,
        NULL, '담임교사', NULL, 2, 300
      );
      INSERT INTO mart_sales (
        id, class_id, buyer_student_id, buyer_student_number_snapshot,
        buyer_student_name_snapshot, total_amount, total_quantity, status,
        revision, created_operation_id, cancelled_operation_id,
        cancelled_reason, created_at, cancelled_at, updated_at
      ) VALUES (
        'sale-mart', 'class-mart', 'buyer-pending-mart', 2, '등록전학생',
        600, 2, 'building', 0, 'op-sale', NULL, NULL, 300, NULL, 300
      );
      INSERT INTO mart_sale_items (
        id, sale_id, class_id, product_id, product_name_snapshot,
        unit_price_snapshot, quantity, line_total, created_at
      ) VALUES (
        'sale-item-mart', 'sale-mart', 'class-mart', 'product-mart', '연필',
        300, 2, 600, 300
      );
      INSERT INTO mart_inventory_movements (
        id, class_id, product_id, operation_id, movement_type, delta,
        quantity_before, quantity_after, inventory_revision_before,
        inventory_revision_after, source_sale_id, source_sale_item_id,
        reason, created_at
      ) VALUES (
        'movement-sale', 'class-mart', 'product-mart', 'op-sale', 'sale',
        -2, 10, 8, 1, 2, 'sale-mart', 'sale-item-mart', NULL, 300
      );
      UPDATE mart_sales SET status = 'posted', updated_at = 300
      WHERE id = 'sale-mart';
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT status, total_amount, total_quantity FROM mart_sales WHERE id = 'sale-mart';
       SELECT quantity, revision FROM mart_inventory WHERE product_id = 'product-mart';`,
    )), [{ quantity: 8, revision: 2 }]);

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-cancel', 'class-mart', 'mart:sale:cancel', 'sale_cancel',
        'sale-mart', 'hash-cancel', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', '판매 입력 오류', 3, 400
      );
      INSERT INTO mart_sale_cancellations (
        id, class_id, sale_id, operation_id, expected_sale_revision,
        reason, cancelled_at, created_at
      ) VALUES (
        'cancel-mart', 'class-mart', 'sale-mart', 'op-cancel', 0,
        '판매 입력 오류', 400, 400
      );
      INSERT INTO mart_inventory_movements (
        id, class_id, product_id, operation_id, movement_type, delta,
        quantity_before, quantity_after, inventory_revision_before,
        inventory_revision_after, source_sale_id, source_sale_item_id,
        reason, created_at
      ) VALUES (
        'movement-cancel', 'class-mart', 'product-mart', 'op-cancel',
        'sale_cancel', 2, 8, 10, 2, 3, 'sale-mart', 'sale-item-mart',
        '판매 입력 오류', 400
      );
      UPDATE mart_sales
      SET status = 'cancelled', revision = 1,
          cancelled_operation_id = 'op-cancel', cancelled_reason = '판매 입력 오류',
          cancelled_at = 400, updated_at = 400
      WHERE id = 'sale-mart' AND revision = 0;
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT status, revision, cancelled_reason FROM mart_sales WHERE id = 'sale-mart';
       SELECT quantity, revision FROM mart_inventory WHERE product_id = 'product-mart';`,
    )), [{ quantity: 10, revision: 3 }]);

    executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-deactivate', 'class-mart', 'mart:product:deactivate', 'product_update',
        'product-mart', 'hash-deactivate', 'market_clerk', NULL, 'clerk-mart',
        'period-mart', '마트직원', NULL, 4, 500
      );
      INSERT INTO mart_product_events (
        id, class_id, product_id, operation_id, revision, action,
        product_snapshot_json, created_at
      ) VALUES (
        'event-deactivate', 'class-mart', 'product-mart', 'op-deactivate', 1,
        'deactivated', '{"name":"연필","isActive":false}', 500
      );
      UPDATE mart_products
      SET is_active = 0, revision = 1, updated_at = 500
      WHERE id = 'product-mart' AND revision = 0;
    `);

    const duplicate = executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-duplicate', 'class-mart', 'mart:product:create', 'product_update',
        'product-mart', 'different-hash', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', NULL, 5, 501
      );
    `, { expectSuccess: false });
    assert.match(duplicate.output, /UNIQUE constraint failed/);

    for (const [sql, pattern] of [
      [`DELETE FROM mart_products WHERE id = 'product-mart';`, /MART_PRODUCT_DELETE_FORBIDDEN/],
      [`UPDATE mart_sale_items SET quantity = 3 WHERE id = 'sale-item-mart';`, /MART_SALE_ITEM_IMMUTABLE/],
      [`DELETE FROM mart_inventory_movements WHERE id = 'movement-sale';`, /MART_INVENTORY_MOVEMENT_IMMUTABLE/],
      [`UPDATE mart_operations SET actor_label = '변경' WHERE id = 'op-sale';`, /MART_OPERATION_IMMUTABLE/],
    ]) {
      const immutable = executeSql(persistPath, sql, { expectSuccess: false });
      assert.match(immutable.output, pattern);
    }

    const excludedBuyer = executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-excluded-sale', 'class-mart', 'mart:sale:excluded', 'sale_create',
        'sale-excluded', 'hash-excluded', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', NULL, 5, 600
      );
      INSERT INTO mart_sales (
        id, class_id, buyer_student_id, buyer_student_number_snapshot,
        buyer_student_name_snapshot, total_amount, total_quantity, status,
        revision, created_operation_id, created_at, updated_at
      ) VALUES (
        'sale-excluded', 'class-mart', 'excluded-mart', 5, '제외학생',
        300, 1, 'building', 0, 'op-excluded-sale', 600, 600
      );
    `, { expectSuccess: false });
    assert.match(excludedBuyer.output, /MART_SALE_CONTEXT_INVALID/);

    const negative = executeSql(persistPath, `
      INSERT INTO mart_operations (
        id, class_id, idempotency_key, operation, resource_id, payload_hash,
        actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
        actor_label, intervention_reason, expected_class_revision, created_at
      ) VALUES (
        'op-negative', 'class-mart', 'mart:inventory:negative', 'inventory_outbound',
        'movement-negative', 'hash-negative', 'teacher', 'teacher-mart', NULL, NULL,
        '담임교사', NULL,
        (SELECT COUNT(*) FROM mart_operations WHERE class_id = 'class-mart'), 700
      );
      INSERT INTO mart_inventory_movements (
        id, class_id, product_id, operation_id, movement_type, delta,
        quantity_before, quantity_after, inventory_revision_before,
        inventory_revision_after, reason, created_at
      ) VALUES (
        'movement-negative', 'class-mart', 'product-mart', 'op-negative',
        'outbound', -11, 10, -1, 3, 4, '재고보다 많은 폐기', 700
      );
    `, { expectSuccess: false });
    assert.match(negative.output, /CHECK constraint failed|MART_INVENTORY_STALE/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT quantity, revision FROM mart_inventory WHERE product_id = 'product-mart';`,
    )), [{ quantity: 10, revision: 3 }]);

    const financeAfter = lastResults(executeSql(
      persistPath,
      `SELECT id, balance, revision FROM finance_accounts ORDER BY id;`,
    ));
    assert.deepEqual(financeAfter, financeBefore, "마트 기록은 디지털 금융 잔액·원장을 바꾸면 안 됩니다.");
    assert.deepEqual(lastResults(executeSql(persistPath, "PRAGMA foreign_key_check;")), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

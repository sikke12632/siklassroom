import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FINANCE_MAX_ABSOLUTE_AMOUNT } from "../lib/finance-ledger-rules";
import {
  FinanceSettingsRuleError,
  financeAmountMatchesDenominations,
  normalizeFinanceSettingsUpdate,
} from "../lib/finance-settings-rules";

function validSettingsInput() {
  return {
    currencyName: " 우리 반 별빛 화폐 ",
    currencyUnit: " 별 ",
    denominations: [1_000, 100, 500],
    bankOpen: true,
    depositEnabled: true,
    withdrawalEnabled: true,
    bankerProcessingEnabled: true,
    maxRequestAmount: 50_000,
    expectedRevision: 3,
    idempotencyKey: "finance-settings:update:0001",
    changeReason: " 학급 회의에서 권종을 정함 ",
  };
}

function settingsError(code: string) {
  return (error: unknown) => (
    error instanceof FinanceSettingsRuleError
    && error.code === code
  );
}

test("금융 설정은 문구 공백을 정리하고 권종을 작은 금액부터 정렬한다", () => {
  assert.deepEqual(
    normalizeFinanceSettingsUpdate(validSettingsInput()),
    {
      values: {
        currencyName: "우리 반 별빛 화폐",
        currencyUnit: "별",
        denominations: [100, 500, 1_000],
        bankOpen: true,
        depositEnabled: true,
        withdrawalEnabled: true,
        bankerProcessingEnabled: true,
        maxRequestAmount: 50_000,
      },
      expectedRevision: 3,
      idempotencyKey: "finance-settings:update:0001",
      changeReason: "학급 회의에서 권종을 정함",
    },
  );
});

test("권종은 중복 없이 1개 이상 8개 이하의 양의 정수만 허용한다", () => {
  assert.throws(
    () => normalizeFinanceSettingsUpdate({
      ...validSettingsInput(),
      denominations: [100, 500, 100],
    }),
    settingsError("FINANCE_SETTINGS_DUPLICATE_DENOMINATION"),
  );

  for (const denominations of [
    [0],
    [-100],
    [1.5],
    [FINANCE_MAX_ABSOLUTE_AMOUNT + 1],
  ]) {
    assert.throws(
      () => normalizeFinanceSettingsUpdate({
        ...validSettingsInput(),
        denominations,
      }),
      settingsError("FINANCE_SETTINGS_INVALID_DENOMINATIONS"),
    );
  }

  assert.throws(
    () => normalizeFinanceSettingsUpdate({
      ...validSettingsInput(),
      denominations: Array.from({ length: 9 }, (_, index) => index + 1),
    }),
    settingsError("FINANCE_SETTINGS_INVALID_DENOMINATIONS"),
  );

  assert.throws(
    () => normalizeFinanceSettingsUpdate({
      ...validSettingsInput(),
      denominations: [200, 500, 1_000],
    }),
    settingsError("FINANCE_SETTINGS_INVALID_DENOMINATIONS"),
  );
});

test("한 번에 신청할 수 있는 최대 금액은 안전한 범위의 양의 정수여야 한다", () => {
  for (const maxRequestAmount of [
    0,
    -1,
    1.5,
    Number.NaN,
    FINANCE_MAX_ABSOLUTE_AMOUNT + 1,
  ]) {
    assert.throws(
      () => normalizeFinanceSettingsUpdate({
        ...validSettingsInput(),
        maxRequestAmount,
      }),
      settingsError("FINANCE_SETTINGS_INVALID_MAX_AMOUNT"),
    );
  }

  assert.throws(
    () => normalizeFinanceSettingsUpdate({
      ...validSettingsInput(),
      denominations: [100, 500],
      maxRequestAmount: 50,
    }),
    settingsError("FINANCE_SETTINGS_INVALID_MAX_AMOUNT"),
  );
});

test("신청 금액은 등록한 가장 작은 권종 단위로 검증한다", () => {
  assert.equal(financeAmountMatchesDenominations(1_500, [100, 500, 1_000]), true);
  assert.equal(financeAmountMatchesDenominations(1_550, [100, 500, 1_000]), false);
});

test("설정 저장은 최신 revision과 안정적인 중복 방지 키를 요구한다", () => {
  for (const expectedRevision of [-1, 1.5, "3"]) {
    assert.throws(
      () => normalizeFinanceSettingsUpdate({
        ...validSettingsInput(),
        expectedRevision,
      }),
      settingsError("FINANCE_SETTINGS_INVALID_REVISION"),
    );
  }

  for (const idempotencyKey of [
    "short",
    "finance settings update",
    "한글-요청-번호",
  ]) {
    assert.throws(
      () => normalizeFinanceSettingsUpdate({
        ...validSettingsInput(),
        idempotencyKey,
      }),
      settingsError("FINANCE_SETTINGS_INVALID_IDEMPOTENCY_KEY"),
    );
  }
});

test("설정 변경 이유는 비어 있지 않은 한 줄 기록으로 남겨야 한다", () => {
  assert.throws(
    () => normalizeFinanceSettingsUpdate({
      ...validSettingsInput(),
      changeReason: "   ",
    }),
    settingsError("FINANCE_SETTINGS_INPUT_REQUIRED"),
  );
  for (const changeReason of [
    "첫 줄\n둘째 줄",
    "가".repeat(301),
  ]) {
    assert.throws(
      () => normalizeFinanceSettingsUpdate({
        ...validSettingsInput(),
        changeReason,
      }),
      settingsError("FINANCE_SETTINGS_INPUT_TOO_LONG"),
    );
  }
});

test("금융 설정 스키마는 현재값과 불변 revision 이력을 함께 보존한다", async () => {
  const [schema, runtime] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, runtime]) {
    assert.match(source, /finance_settings/);
    assert.match(source, /finance_setting_revisions/);
  }
  assert.match(
    runtime,
    /CREATE TRIGGER IF NOT EXISTS finance_setting_revisions_update_guard/,
  );
  assert.match(
    runtime,
    /CREATE TRIGGER IF NOT EXISTS finance_setting_revisions_delete_guard/,
  );
  assert.match(runtime, /FINANCE_SETTINGS_REVISION_IMMUTABLE/);
});

test("기존 학급은 종전 신청 한도를 보존하고 새 학급만 새 기본 한도를 사용한다", async () => {
  const [migration, runtime] = await Promise.all([
    readFile(
      new URL("../drizzle/0011_bright_johnny_storm.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(
      source,
      /NEW\.id,[\s\S]{0,180}1,\s*1,\s*1,\s*1,\s*100000,\s*0,\s*NULL/,
    );
    assert.match(
      source,
      /FROM classes class_row[\s\S]*?class_row\.id,[\s\S]{0,180}1,\s*1,\s*1,\s*1,\s*1000000000,\s*0,\s*NULL|class_row\.id,[\s\S]{0,180}1,\s*1,\s*1,\s*1,\s*1000000000,\s*0,\s*NULL[\s\S]*?FROM classes class_row/,
    );
  }
});

test("D1은 은행 운영 상태와 입출금·은행원 처리 설정을 쓰기 시점에 강제한다", async () => {
  const runtime = await readFile(
    new URL("../lib/finance-schema.ts", import.meta.url),
    "utf8",
  );

  assert.match(runtime, /finance_(?:cash_requests|request_resolutions)_settings_guard/);
  assert.match(runtime, /bank_open/);
  assert.match(runtime, /deposit_enabled/);
  assert.match(runtime, /withdrawal_enabled/);
  assert.match(runtime, /banker_processing_enabled/);
  assert.match(runtime, /FINANCE_BANK_CLOSED/);
  assert.match(runtime, /FINANCE_DEPOSIT_DISABLED/);
  assert.match(runtime, /FINANCE_WITHDRAWAL_DISABLED/);
  assert.match(runtime, /FINANCE_BANKER_PROCESSING_DISABLED/);
  assert.match(runtime, /max_request_amount/);
});

test("금융 설정 API는 담임 교사 소유권과 expectedRevision을 서버에서 확인한다", async () => {
  const [service, route] = await Promise.all([
    readFile(new URL("../lib/finance-settings.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/finance/settings/route.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(service, /financeContextForRequest\(request\)/);
  assert.match(service, /context\.financeRole !== "teacher"/);
  assert.match(service, /expectedRevision/);
  assert.match(service, /FINANCE_SETTINGS_STALE/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /settingsFromRevision\(duplicate\)/);
  assert.match(service, /settingsFromRevision\(concurrentDuplicate\)/);
  assert.doesNotMatch(
    service,
    /stored\.revision !== nextRevision/,
  );
  assert.match(route, /readJson/);
  assert.match(route, /expectedRevision/);
  assert.match(route, /private, no-store/);
});

test("교사 개입 사유는 교사 조회에만 포함하고 학생·은행원에게 숨긴다", async () => {
  const overview = await readFile(
    new URL("../lib/finance-overview.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    overview,
    /interventionReason:\s*context\.financeRole === "teacher"\s*\?\s*row\.intervention_reason\s*:\s*null/,
  );
});

test("거래 정정 API는 화면 상태와 무관하게 서버에서 원장 일치를 다시 확인한다", async () => {
  const service = await readFile(
    new URL("../lib/finance-requests.ts", import.meta.url),
    "utf8",
  );
  const reversalSection = service.slice(
    service.indexOf("export async function reverseFinanceTransactionForRequest"),
  );

  assert.match(reversalSection, /financeReconciliation\(context\.classroom\.id\)/);
  assert.match(reversalSection, /mismatches/);
  assert.match(reversalSection, /pendingTransactionCount/);
  assert.match(reversalSection, /FINANCE_LEDGER_ATTENTION/);
  assert.match(reversalSection, /reverseFinanceTransaction\(/);
});

test("교사 금융 기록은 신청 결과와 설정 변경 전후를 사람이 읽을 수 있게 연결한다", async () => {
  const audit = await readFile(
    new URL("../lib/finance-audit.ts", import.meta.url),
    "utf8",
  );

  assert.match(audit, /COALESCE\(resolution\.decision, 'pending'\) AS outcome/);
  assert.match(audit, /previous_settings_json/);
  assert.match(audit, /settings_json/);
  assert.match(audit, /settingAuditDetail/);
  assert.match(audit, /변경:/);
  assert.match(audit, /replaceAll\("%", "!%"\)/);
  assert.match(audit, /LIKE \? ESCAPE '!'/);
});

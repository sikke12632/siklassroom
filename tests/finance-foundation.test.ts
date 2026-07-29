import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  permissionsForFinanceRole,
  resolveFinanceRole,
  selectEffectiveFinancePeriod,
} from "../lib/finance-access-rules";

type PeriodCandidate = Parameters<typeof selectEffectiveFinancePeriod>[0][number];
type CurrentMonth = Parameters<typeof selectEffectiveFinancePeriod>[1];

const JULY_2026: CurrentMonth = {
  classId: "class-a",
  year: 2026,
  month: 7,
};

function period(overrides: Partial<PeriodCandidate> = {}): PeriodCandidate {
  return {
    id: "period-july",
    classId: "class-a",
    status: "confirmed",
    assignmentType: "monthly",
    assignmentYear: 2026,
    assignmentMonth: 7,
    confirmedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    updatedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("교사는 은행원 배정 여부와 무관하게 금융센터 교사 역할을 가진다", () => {
  assert.equal(resolveFinanceRole("teacher", false), "teacher");
  assert.equal(resolveFinanceRole("teacher", true), "teacher");
});

test("학생은 유효한 은행원 배정이 있을 때만 은행원 역할을 가진다", () => {
  assert.equal(resolveFinanceRole("student", false), "student");
  assert.equal(resolveFinanceRole("student", true), "banker");
});

test("학생 자율 운영과 교사 비상 개입 권한을 역할별로 분리한다", () => {
  assert.deepEqual(permissionsForFinanceRole("teacher"), {
    canOperateBank: true,
    canViewAudit: true,
    canOverride: true,
  });
  assert.deepEqual(permissionsForFinanceRole("banker"), {
    canOperateBank: true,
    canViewAudit: false,
    canOverride: false,
  });
  assert.deepEqual(permissionsForFinanceRole("student"), {
    canOperateBank: false,
    canViewAudit: false,
    canOverride: false,
  });
});

test("보관된 학급은 교사 기록 조회만 허용하고 새 금융 조작은 막는다", () => {
  assert.deepEqual(permissionsForFinanceRole("teacher", false), {
    canOperateBank: false,
    canViewAudit: true,
    canOverride: false,
  });
});

test("현재 서울 연월 이하의 같은 학급 확정 배정 중 가장 최신 배정을 선택한다", () => {
  const selected = selectEffectiveFinancePeriod([
    period({
      id: "period-june",
      assignmentMonth: 6,
      confirmedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
    }),
    period({ id: "period-july" }),
    period({
      id: "period-july-draft",
      status: "draft",
      confirmedAt: null,
      updatedAt: Date.parse("2026-07-20T00:00:00.000Z"),
    }),
    period({
      id: "period-august",
      assignmentMonth: 8,
      confirmedAt: Date.parse("2026-07-20T00:00:00.000Z"),
      updatedAt: Date.parse("2026-07-20T00:00:00.000Z"),
    }),
    period({
      id: "period-other-class",
      classId: "class-b",
      confirmedAt: Date.parse("2026-07-25T00:00:00.000Z"),
      updatedAt: Date.parse("2026-07-25T00:00:00.000Z"),
    }),
    period({
      id: "period-unsupported",
      assignmentType: "legacy",
      confirmedAt: Date.parse("2026-07-30T00:00:00.000Z"),
      updatedAt: Date.parse("2026-07-30T00:00:00.000Z"),
    }),
  ], JULY_2026);

  assert.equal(selected?.id, "period-july");
});

test("이번 달 배정이 초안뿐이면 직전 확정 배정을 계속 사용한다", () => {
  const selected = selectEffectiveFinancePeriod([
    period({
      id: "period-june-confirmed",
      assignmentMonth: 6,
      confirmedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
    }),
    period({
      id: "period-july-draft",
      status: "draft",
      confirmedAt: null,
      updatedAt: Date.parse("2026-07-20T00:00:00.000Z"),
    }),
  ], JULY_2026);

  assert.equal(selected?.id, "period-june-confirmed");
});

test("같은 달의 확정 배정이 둘이면 더 나중에 확정된 배정을 사용한다", () => {
  const selected = selectEffectiveFinancePeriod([
    period({
      id: "period-initial",
      assignmentType: "initial",
      confirmedAt: Date.parse("2026-07-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    }),
    period({
      id: "period-monthly",
      assignmentType: "monthly",
      confirmedAt: Date.parse("2026-07-10T00:00:00.000Z"),
      updatedAt: Date.parse("2026-07-10T00:00:00.000Z"),
    }),
  ], JULY_2026);

  assert.equal(selected?.id, "period-monthly");
});

test("새 확정 배정이 생기면 이전 은행원 권한은 사라지고 새 은행원에게 넘어간다", () => {
  const june = period({
    id: "period-june",
    assignmentMonth: 6,
    confirmedAt: Date.parse("2026-06-01T00:00:00.000Z"),
    updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
  });
  const july = period({ id: "period-july" });
  const bankerAssignments = new Map([
    [june.id, new Set(["student-old-banker"])],
    [july.id, new Set(["student-new-banker"])],
  ]);
  const roleAt = (
    periods: PeriodCandidate[],
    studentId: string,
  ) => {
    const selected = selectEffectiveFinancePeriod(periods, JULY_2026);
    return resolveFinanceRole(
      "student",
      Boolean(selected && bankerAssignments.get(selected.id)?.has(studentId)),
    );
  };

  assert.equal(roleAt([june], "student-old-banker"), "banker");
  assert.equal(roleAt([june], "student-new-banker"), "student");
  assert.equal(roleAt([june, july], "student-old-banker"), "student");
  assert.equal(roleAt([june, july], "student-new-banker"), "banker");
});

test("확정됐더라도 미래 달 배정은 그 달이 되기 전에는 권한을 바꾸지 않는다", () => {
  const july = period({ id: "period-july" });
  const august = period({
    id: "period-august",
    assignmentMonth: 8,
    confirmedAt: Date.parse("2026-07-20T00:00:00.000Z"),
    updatedAt: Date.parse("2026-07-20T00:00:00.000Z"),
  });

  assert.equal(selectEffectiveFinancePeriod([july, august], JULY_2026)?.id, "period-july");
  assert.equal(
    selectEffectiveFinancePeriod(
      [july, august],
      { ...JULY_2026, month: 8 },
    )?.id,
    "period-august",
  );
});

test("유효한 확정 배정이 없으면 선택 결과가 없다", () => {
  assert.equal(
    selectEffectiveFinancePeriod([
      period({ status: "draft", confirmedAt: null }),
      period({ classId: "class-b" }),
      period({ assignmentMonth: 8 }),
    ], JULY_2026),
    null,
  );
});

test("금융 컨텍스트는 기존 인증·학급 소유권과 안정적인 은행원 직업 ID를 사용한다", async () => {
  const [rules, access, route] = await Promise.all([
    readFile(new URL("../lib/finance-access-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/context/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(access, /requireClassManagement\(request\)/);
  assert.match(access, /ownedClass\(teacherId,\s*classId\)/);
  assert.match(access, /requireStudent\(request\)/);
  assert.match(access, /requestedClassId\s*&&\s*requestedClassId\s*!==\s*student\.class_id/);
  assert.match(access, /FINANCE_CLASS_ACCESS_DENIED/);
  assert.match(access, /activeJob\?\.templateId\s*===\s*BANKER_JOB_TEMPLATE_ID/);
  assert.match(rules, /BANKER_JOB_TEMPLATE_ID\s*=\s*"banker"/);
  assert.doesNotMatch(access, /activeJob\?\.name\s*===/);
  assert.match(access, /assignment\.period_id\s*=\s*\?/);
  assert.match(access, /assignment\.class_id\s*=\s*\?/);
  assert.match(access, /assignment\.student_id\s*=\s*\?/);
  assert.match(access, /j\.class_id\s*=\s*assignment\.class_id/);
  assert.match(route, /financeContextForRequest\(request\)/);
  assert.match(route, /response\.headers\.set\("Cache-Control",\s*"private, no-store"\)/);
});

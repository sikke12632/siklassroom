export const LIFE_CHECK_TYPES = ["tooth", "milk", "lunch"] as const;

export type LifeCheckType = typeof LIFE_CHECK_TYPES[number];
export type LifeCheckPeriod = "first" | "second";

export const LIFE_CHECK_INFO: Record<LifeCheckType, {
  label: string;
  shortLabel: string;
  jobTemplateId: string;
}> = {
  tooth: {
    label: "양치 확인",
    shortLabel: "양치",
    jobTemplateId: "routine-checker",
  },
  milk: {
    label: "우유 확인",
    shortLabel: "우유",
    jobTemplateId: "milk-manager",
  },
  lunch: {
    label: "급식 확인",
    shortLabel: "급식",
    jobTemplateId: "meal-checker",
  },
};

export class LifeCheckRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

export function parseLifeCheckType(value: unknown): LifeCheckType {
  if (typeof value === "string" && LIFE_CHECK_TYPES.includes(value as LifeCheckType)) {
    return value as LifeCheckType;
  }
  throw new LifeCheckRuleError("확인 항목을 다시 선택해 주세요.", "LIFE_CHECK_TYPE_INVALID");
}

export function parseLifeCheckPeriod(value: unknown): LifeCheckPeriod {
  if (value === "first" || value === "second") return value;
  throw new LifeCheckRuleError("상반기 또는 하반기를 선택해 주세요.", "LIFE_CHECK_PERIOD_INVALID");
}

export function splitSchoolDays(dates: readonly string[]) {
  const middle = Math.ceil(dates.length / 2);
  return {
    first: dates.slice(0, middle),
    second: dates.slice(middle),
  } satisfies Record<LifeCheckPeriod, readonly string[]>;
}

export function baseLifeCheckReward(
  type: LifeCheckType,
  passedCount: number,
  totalCount: number,
) {
  if (!Number.isInteger(passedCount) || !Number.isInteger(totalCount) || totalCount < 1) return 0;
  const safePassed = Math.max(0, Math.min(passedCount, totalCount));
  if (type === "lunch") {
    if (safePassed >= Math.ceil(totalCount * 0.8)) return 200;
    if (safePassed >= Math.ceil(totalCount * 0.5)) return 100;
    return 0;
  }
  return safePassed >= Math.ceil(totalCount * 0.7) ? 100 : 0;
}

export function calculateLifeCheckReward(input: {
  type: LifeCheckType;
  period: LifeCheckPeriod;
  passedCount: number;
  periodTotal: number;
  firstPassedCount: number;
  firstTotal: number;
  secondPassedCount: number;
  secondTotal: number;
}) {
  const baseAmount = baseLifeCheckReward(input.type, input.passedCount, input.periodTotal);
  const fullMonthBonus = input.period === "second"
    && input.firstTotal > 0
    && input.secondTotal > 0
    && input.firstPassedCount === input.firstTotal
    && input.secondPassedCount === input.secondTotal
      ? 100
      : 0;
  return {
    baseAmount,
    bonusAmount: fullMonthBonus,
    amount: baseAmount + fullMonthBonus,
  };
}

export function rewardReason(input: {
  type: LifeCheckType;
  year: number;
  month: number;
  period: LifeCheckPeriod;
  passedCount: number;
  totalCount: number;
  bonusAmount: number;
}) {
  const info = LIFE_CHECK_INFO[input.type];
  const half = input.period === "first" ? "상반기" : "하반기";
  const bonus = input.bonusAmount > 0 ? " + 한 달 전체 통과 보너스" : "";
  return `${info.label} ${input.year}년 ${input.month}월 ${half} ${input.passedCount}/${input.totalCount}일 통과${bonus}`;
}

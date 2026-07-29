export const BANKER_JOB_TEMPLATE_ID = "banker";

export type FinanceRole = "teacher" | "banker" | "student";

export type FinancePermissions = {
  canOperateBank: boolean;
  canViewAudit: boolean;
  canOverride: boolean;
};

export type FinancePeriodCandidate = {
  id: string;
  classId: string;
  status: string;
  assignmentType: string;
  assignmentYear: number;
  assignmentMonth: number;
  confirmedAt: number | null;
  updatedAt: number;
};

type CurrentPeriod = {
  classId: string;
  year: number;
  month: number;
};

function periodSortValue(period: FinancePeriodCandidate) {
  return [
    period.assignmentYear,
    period.assignmentMonth,
    period.confirmedAt ?? 0,
    period.updatedAt,
  ] as const;
}

function comparePeriodsDescending(
  left: FinancePeriodCandidate,
  right: FinancePeriodCandidate,
) {
  const leftValues = periodSortValue(left);
  const rightValues = periodSortValue(right);
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) {
      return rightValues[index] - leftValues[index];
    }
  }
  return right.id.localeCompare(left.id);
}

/**
 * Selects the assignment that is in effect for finance permissions.
 *
 * A future month may already be confirmed for classroom planning. It must not
 * replace the current banker before that month starts. When the current month
 * has no confirmed period, the most recent earlier confirmation stays active.
 */
export function selectEffectiveFinancePeriod(
  periods: readonly FinancePeriodCandidate[],
  current: CurrentPeriod,
): FinancePeriodCandidate | null {
  return periods
    .filter((period) => (
      period.classId === current.classId
      && period.status === "confirmed"
      && (period.assignmentType === "initial" || period.assignmentType === "monthly")
      && (
        period.assignmentYear < current.year
        || (
          period.assignmentYear === current.year
          && period.assignmentMonth <= current.month
        )
      )
    ))
    .sort(comparePeriodsDescending)[0] ?? null;
}

export function resolveFinanceRole(
  actorType: "teacher" | "student",
  hasCurrentBankerAssignment: boolean,
): FinanceRole {
  if (actorType === "teacher") return "teacher";
  return hasCurrentBankerAssignment ? "banker" : "student";
}

export function permissionsForFinanceRole(
  role: FinanceRole,
  classIsActive = true,
): FinancePermissions {
  if (role === "teacher") {
    return {
      canOperateBank: classIsActive,
      canViewAudit: true,
      canOverride: classIsActive,
    };
  }
  if (role === "banker") {
    return {
      canOperateBank: true,
      canViewAudit: false,
      canOverride: false,
    };
  }
  return {
    canOperateBank: false,
    canViewAudit: false,
    canOverride: false,
  };
}

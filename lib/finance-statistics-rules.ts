export type FinanceStatisticsRole = "teacher" | "banker" | "student";

export type FinanceStudentAssetInput = {
  studentId: string;
  studentNumber: number;
  studentName: string;
  wallet: number;
  deposits: number;
  stocks: number;
  funding: number;
};

export type FinanceStudentAsset = FinanceStudentAssetInput & {
  total: number;
};

export type FinanceAssetDistributionBucket = {
  key: "zero" | "below_half" | "around_average" | "above_average";
  count: number;
};

export type FinanceAssetSummary = {
  activeStudentCount: number;
  trackedTotal: number;
  walletTotal: number;
  depositValueTotal: number;
  stockMarketValueTotal: number;
  fundingLockedTotal: number;
  average: number | null;
  median: number | null;
};

export type FinanceStatisticsProjection = {
  distribution: FinanceAssetDistributionBucket[] | null;
  ownAsset?: FinanceStudentAsset;
  students?: FinanceStudentAsset[];
};

export type FinanceMoneyChange = {
  previous: number | null;
  change: number | null;
  changeBps: number | null;
};

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000;

function assertNonNegativeSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function safeAdd(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${label} exceeds the supported finance range`);
  }
  return result;
}

export function previousSeoulMonthEnd(input: {
  year: number;
  month: number;
}) {
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    throw new RangeError("year must be between 2020 and 2100");
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new RangeError("month must be between 1 and 12");
  }

  const currentMonthStart = Date.UTC(
    input.year,
    input.month - 1,
    1,
  ) - SEOUL_OFFSET_MS;
  const previousMonthDate = new Date(currentMonthStart - 1);
  const previousMonthInSeoul = new Date(previousMonthDate.getTime() + SEOUL_OFFSET_MS);
  const previousYear = previousMonthInSeoul.getUTCFullYear();
  const previousMonth = previousMonthInSeoul.getUTCMonth() + 1;

  return {
    cutoffEpochMs: currentMonthStart - 1,
    monthValue: `${previousYear}-${String(previousMonth).padStart(2, "0")}`,
  };
}

export function calculateFinanceMoneyChange(
  current: number,
  previous: number | null,
): FinanceMoneyChange {
  assertNonNegativeSafeInteger(current, "current money supply");
  if (previous === null) {
    return { previous: null, change: null, changeBps: null };
  }
  assertNonNegativeSafeInteger(previous, "previous money supply");
  const change = current - previous;
  if (!Number.isSafeInteger(change)) {
    throw new RangeError("money supply change exceeds the supported finance range");
  }
  if (previous === 0) {
    return { previous, change, changeBps: null };
  }
  const changeBps = Math.round((change / previous) * 10_000);
  if (!Number.isSafeInteger(changeBps)) {
    throw new RangeError("money supply rate exceeds the supported finance range");
  }
  return { previous, change, changeBps };
}

export function recordedFinanceMoneySupply(
  walletBalance: number,
  depositPrincipal: number,
  fundingLocked = 0,
) {
  assertNonNegativeSafeInteger(walletBalance, "wallet balance");
  assertNonNegativeSafeInteger(depositPrincipal, "deposit principal");
  assertNonNegativeSafeInteger(fundingLocked, "funding locked");
  const walletAndDeposits = safeAdd(
    walletBalance,
    depositPrincipal,
    "recorded money supply",
  );
  return safeAdd(walletAndDeposits, fundingLocked, "recorded money supply");
}

export function normalizeFinanceStudentAssets(
  rows: readonly FinanceStudentAssetInput[],
): FinanceStudentAsset[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row.studentId.trim() || seen.has(row.studentId)) {
      throw new RangeError("student asset rows require unique student ids");
    }
    seen.add(row.studentId);
    if (!Number.isSafeInteger(row.studentNumber) || row.studentNumber <= 0) {
      throw new RangeError("student number must be a positive safe integer");
    }
    for (const [label, value] of [
      ["wallet", row.wallet],
      ["deposits", row.deposits],
      ["stocks", row.stocks],
      ["funding", row.funding],
    ] as const) {
      assertNonNegativeSafeInteger(value, label);
    }
    const liquidAndDeposits = safeAdd(row.wallet, row.deposits, "student assets");
    const withStocks = safeAdd(liquidAndDeposits, row.stocks, "student assets");
    const total = safeAdd(withStocks, row.funding, "student assets");
    return {
      ...row,
      studentName: row.studentName.trim(),
      total,
    };
  }).sort((left, right) => (
    left.studentNumber - right.studentNumber
    || left.studentId.localeCompare(right.studentId)
  ));
}

export function summarizeFinanceStudentAssets(
  rows: readonly FinanceStudentAsset[],
): FinanceAssetSummary {
  let trackedTotal = 0;
  let walletTotal = 0;
  let depositValueTotal = 0;
  let stockMarketValueTotal = 0;
  let fundingLockedTotal = 0;
  for (const row of rows) {
    walletTotal = safeAdd(walletTotal, row.wallet, "wallet total");
    depositValueTotal = safeAdd(
      depositValueTotal,
      row.deposits,
      "deposit value total",
    );
    stockMarketValueTotal = safeAdd(
      stockMarketValueTotal,
      row.stocks,
      "stock market value total",
    );
    fundingLockedTotal = safeAdd(
      fundingLockedTotal,
      row.funding,
      "funding locked total",
    );
    trackedTotal = safeAdd(trackedTotal, row.total, "tracked asset total");
  }

  const sortedTotals = rows.map((row) => row.total).sort((a, b) => a - b);
  const middle = Math.floor(sortedTotals.length / 2);
  const median = sortedTotals.length === 0
    ? null
    : sortedTotals.length % 2 === 1
      ? sortedTotals[middle]
      : Math.round((sortedTotals[middle - 1] + sortedTotals[middle]) / 2);

  return {
    activeStudentCount: rows.length,
    trackedTotal,
    walletTotal,
    depositValueTotal,
    stockMarketValueTotal,
    fundingLockedTotal,
    average: rows.length === 0 ? null : Math.round(trackedTotal / rows.length),
    median,
  };
}

export function financeAssetDistribution(
  rows: readonly FinanceStudentAsset[],
  average: number | null,
): FinanceAssetDistributionBucket[] {
  const counts: Record<FinanceAssetDistributionBucket["key"], number> = {
    zero: 0,
    below_half: 0,
    around_average: 0,
    above_average: 0,
  };

  for (const row of rows) {
    if (row.total === 0 || average === null || average === 0) {
      counts.zero += 1;
    } else if (row.total * 2 < average) {
      counts.below_half += 1;
    } else if (row.total * 2 <= average * 3) {
      counts.around_average += 1;
    } else {
      counts.above_average += 1;
    }
  }

  return (Object.keys(counts) as FinanceAssetDistributionBucket["key"][])
    .map((key) => ({ key, count: counts[key] }));
}

export function projectFinanceStatistics(
  role: FinanceStatisticsRole,
  actorStudentId: string | null,
  rows: readonly FinanceStudentAsset[],
  summary: FinanceAssetSummary,
): FinanceStatisticsProjection {
  if (role === "teacher") {
    return {
      distribution: financeAssetDistribution(rows, summary.average),
      students: rows.map((row) => ({ ...row })),
    };
  }

  if (role === "banker") {
    return {
      distribution: rows.length >= 5
        ? financeAssetDistribution(rows, summary.average)
        : null,
    };
  }

  const ownAsset = actorStudentId
    ? rows.find((row) => row.studentId === actorStudentId)
    : undefined;
  return {
    distribution: null,
    ...(ownAsset ? { ownAsset: { ...ownAsset } } : {}),
  };
}

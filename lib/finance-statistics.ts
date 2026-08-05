import { database } from "./database";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import { financeReconciliation } from "./finance-ledger";
import { financeSettingsForClass } from "./finance-settings";
import {
  type FinanceAssetDistributionBucket,
  type FinanceAssetSummary,
  type FinanceStudentAsset,
  calculateFinanceMoneyChange,
  normalizeFinanceStudentAssets,
  previousSeoulMonthEnd,
  projectFinanceStatistics,
  recordedFinanceMoneySupply,
  summarizeFinanceStudentAssets,
} from "./finance-statistics-rules";
import { seoulServerTime } from "./seoul-time";

type MoneySupplyRow = {
  point: "current" | "previous";
  cutoff_epoch_ms: number;
  wallet_balance: number;
  deposit_principal: number;
  funding_locked: number;
  record_count: number;
};

type StudentAssetRow = {
  student_id: string;
  student_number: number;
  student_name: string;
  wallet_balance: number;
  deposit_value: number;
  stock_market_value: number;
  funding_locked: number;
};

export type FinanceStatisticsDataQuality = "ok" | "attention";

export type FinanceStatisticsResponse = {
  context: {
    financeRole: FinanceContext["financeRole"];
    actorType: FinanceContext["actor"]["type"];
    classId: string;
  };
  serverTime: number;
  currencyUnit: string;
  dataQuality: FinanceStatisticsDataQuality;
  moneySupply: {
    metricType: "recorded_money_supply";
    current: number;
    walletBalance: number;
    depositPrincipal: number;
    fundingLocked: number;
    previousMonthValue: string;
    previousMonthEnd: number | null;
    change: number | null;
    changeBps: number | null;
    actualPriceInflationMeasured: false;
  };
  assets: FinanceAssetSummary;
  distribution: FinanceAssetDistributionBucket[] | null;
  ownAsset?: FinanceStudentAsset;
  students?: FinanceStudentAsset[];
};

const MONEY_SUPPLY_SQL = `
  WITH cutoffs(point, cutoff_epoch_ms) AS (
    VALUES ('current', ?), ('previous', ?)
  )
  SELECT cutoff.point, cutoff.cutoff_epoch_ms,
         COALESCE((
           SELECT SUM(entry.amount)
           FROM finance_ledger_entries entry
           JOIN finance_transactions transaction_row
             ON transaction_row.id = entry.transaction_id
            AND transaction_row.class_id = entry.class_id
            AND transaction_row.status = 'posted'
           JOIN finance_accounts account
             ON account.id = entry.account_id
            AND account.class_id = entry.class_id
            AND account.account_type = 'student_wallet'
           WHERE entry.class_id = ?
             AND transaction_row.posted_at <= cutoff.cutoff_epoch_ms
         ), 0) AS wallet_balance,
         COALESCE((
           SELECT SUM(contract.principal)
           FROM finance_deposit_contracts contract
           WHERE contract.class_id = ?
             AND contract.opened_at <= cutoff.cutoff_epoch_ms
             AND NOT EXISTS (
               SELECT 1
               FROM finance_deposit_settlements settlement
               WHERE settlement.contract_id = contract.id
                 AND settlement.class_id = contract.class_id
                 AND settlement.settled_at <= cutoff.cutoff_epoch_ms
             )
         ), 0) AS deposit_principal,
         COALESCE((
           SELECT SUM(contribution.amount)
           FROM finance_funding_contributions contribution
           JOIN finance_transactions contribution_transaction
             ON contribution_transaction.id = contribution.posted_transaction_id
            AND contribution_transaction.class_id = contribution.class_id
            AND contribution_transaction.status = 'posted'
           WHERE contribution.class_id = ?
             AND contribution_transaction.posted_at <= cutoff.cutoff_epoch_ms
             AND NOT EXISTS (
               SELECT 1
               FROM finance_funding_settlements settlement
               JOIN finance_transactions settlement_transaction
                 ON settlement_transaction.id = settlement.posted_transaction_id
                AND settlement_transaction.class_id = settlement.class_id
                AND settlement_transaction.status = 'posted'
               WHERE settlement.class_id = contribution.class_id
                 AND settlement.campaign_id = contribution.campaign_id
                 AND settlement_transaction.posted_at <= cutoff.cutoff_epoch_ms
             )
             AND NOT EXISTS (
               SELECT 1
               FROM finance_funding_refunds refund
               JOIN finance_transactions refund_transaction
                 ON refund_transaction.id = refund.posted_transaction_id
                AND refund_transaction.class_id = refund.class_id
                AND refund_transaction.status = 'posted'
               WHERE refund.class_id = contribution.class_id
                 AND refund.contribution_id = contribution.id
                 AND refund_transaction.posted_at <= cutoff.cutoff_epoch_ms
             )
         ), 0) AS funding_locked,
         (
           SELECT COUNT(*)
           FROM finance_ledger_entries entry
           JOIN finance_transactions transaction_row
             ON transaction_row.id = entry.transaction_id
            AND transaction_row.class_id = entry.class_id
            AND transaction_row.status = 'posted'
           JOIN finance_accounts account
             ON account.id = entry.account_id
            AND account.class_id = entry.class_id
            AND account.account_type = 'student_wallet'
           WHERE entry.class_id = ?
             AND transaction_row.posted_at <= cutoff.cutoff_epoch_ms
         ) + (
           SELECT COUNT(*)
           FROM finance_deposit_contracts contract
           WHERE contract.class_id = ?
             AND contract.opened_at <= cutoff.cutoff_epoch_ms
         ) AS record_count
  FROM cutoffs cutoff
  ORDER BY CASE cutoff.point WHEN 'current' THEN 0 ELSE 1 END`;

const STUDENT_ASSET_SQL = `
  WITH parameters(now_epoch_ms) AS (VALUES (?)),
  active_deposits AS (
    SELECT contract.student_id,
           SUM(CASE
             WHEN (SELECT now_epoch_ms FROM parameters) >= contract.matures_at
               THEN contract.maturity_payout
             ELSE contract.early_payout
           END) AS deposit_value
    FROM finance_deposit_contracts contract
    WHERE contract.class_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM finance_deposit_settlements settlement
        WHERE settlement.contract_id = contract.id
          AND settlement.class_id = contract.class_id
      )
    GROUP BY contract.student_id
  ), stock_values AS (
    SELECT holding.student_id,
           SUM(holding.quantity * stock.current_price) AS stock_market_value
    FROM finance_stock_holdings holding
    JOIN finance_stocks stock
      ON stock.id = holding.stock_id
     AND stock.class_id = holding.class_id
    WHERE holding.class_id = ?
      AND holding.quantity > 0
    GROUP BY holding.student_id
  ), funding_values AS (
    SELECT contribution.contributor_student_id AS student_id,
           SUM(contribution.amount) AS funding_locked
    FROM finance_funding_contributions contribution
    JOIN finance_transactions contribution_transaction
      ON contribution_transaction.id = contribution.posted_transaction_id
     AND contribution_transaction.class_id = contribution.class_id
     AND contribution_transaction.status = 'posted'
     AND contribution_transaction.posted_at <= (
       SELECT now_epoch_ms FROM parameters
     )
    WHERE contribution.class_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM finance_funding_settlements settlement
        JOIN finance_transactions settlement_transaction
          ON settlement_transaction.id = settlement.posted_transaction_id
         AND settlement_transaction.class_id = settlement.class_id
         AND settlement_transaction.status = 'posted'
         AND settlement_transaction.posted_at <= (
           SELECT now_epoch_ms FROM parameters
         )
        WHERE settlement.class_id = contribution.class_id
          AND settlement.campaign_id = contribution.campaign_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance_funding_refunds refund
        JOIN finance_transactions refund_transaction
          ON refund_transaction.id = refund.posted_transaction_id
         AND refund_transaction.class_id = refund.class_id
         AND refund_transaction.status = 'posted'
         AND refund_transaction.posted_at <= (
           SELECT now_epoch_ms FROM parameters
         )
        WHERE refund.class_id = contribution.class_id
          AND refund.contribution_id = contribution.id
      )
    GROUP BY contribution.contributor_student_id
  )
  SELECT student.id AS student_id,
         student.student_number,
         student.official_name AS student_name,
         COALESCE(wallet.balance, 0) AS wallet_balance,
         COALESCE(active_deposits.deposit_value, 0) AS deposit_value,
         COALESCE(stock_values.stock_market_value, 0) AS stock_market_value,
         COALESCE(funding_values.funding_locked, 0) AS funding_locked
  FROM students student
  LEFT JOIN finance_accounts wallet
    ON wallet.student_id = student.id
   AND wallet.class_id = student.class_id
   AND wallet.account_type = 'student_wallet'
  LEFT JOIN active_deposits ON active_deposits.student_id = student.id
  LEFT JOIN stock_values ON stock_values.student_id = student.id
  LEFT JOIN funding_values ON funding_values.student_id = student.id
  WHERE student.class_id = ?
    AND student.status <> 'excluded'
  ORDER BY student.student_number, student.id`;

function rowsFromResult<T>(result: D1Result<unknown>): T[] {
  return (result.results ?? []) as T[];
}

function moneyRow(
  rows: readonly MoneySupplyRow[],
  point: MoneySupplyRow["point"],
) {
  const row = rows.find((candidate) => candidate.point === point);
  if (!row) throw new Error(`finance statistics ${point} row is unavailable`);
  const walletBalance = Number(row.wallet_balance);
  const depositPrincipal = Number(row.deposit_principal);
  const fundingLocked = Number(row.funding_locked);
  return {
    walletBalance,
    depositPrincipal,
    fundingLocked,
    total: recordedFinanceMoneySupply(
      walletBalance,
      depositPrincipal,
      fundingLocked,
    ),
    recordCount: Number(row.record_count),
  };
}

export async function financeStatisticsForRequest(
  request: Request,
): Promise<FinanceStatisticsResponse> {
  const context = await financeContextForRequest(request);
  const now = Date.now();
  const currentSeoulTime = seoulServerTime(now);
  const previousMonth = previousSeoulMonthEnd({
    year: currentSeoulTime.year,
    month: currentSeoulTime.month,
  });
  const db = database();

  const [batchResults, settings, reconciliation] = await Promise.all([
    db.batch([
      db.prepare(MONEY_SUPPLY_SQL).bind(
        now,
        previousMonth.cutoffEpochMs,
        context.classroom.id,
        context.classroom.id,
        context.classroom.id,
        context.classroom.id,
        context.classroom.id,
      ),
      db.prepare(STUDENT_ASSET_SQL).bind(
        now,
        context.classroom.id,
        context.classroom.id,
        context.classroom.id,
        context.classroom.id,
      ),
    ]),
    financeSettingsForClass(context.classroom.id),
    financeReconciliation(context.classroom.id),
  ]);

  const moneyRows = rowsFromResult<MoneySupplyRow>(batchResults[0]);
  const studentRows = rowsFromResult<StudentAssetRow>(batchResults[1]);
  const current = moneyRow(moneyRows, "current");
  const previous = moneyRow(moneyRows, "previous");
  const previousValue = previous.recordCount > 0 ? previous.total : null;
  const change = calculateFinanceMoneyChange(current.total, previousValue);
  const students = normalizeFinanceStudentAssets(studentRows.map((row) => ({
    studentId: row.student_id,
    studentNumber: Number(row.student_number),
    studentName: row.student_name,
    wallet: Number(row.wallet_balance),
    deposits: Number(row.deposit_value),
    stocks: Number(row.stock_market_value),
    funding: Number(row.funding_locked),
  })));
  const assets = summarizeFinanceStudentAssets(students);
  const projection = projectFinanceStatistics(
    context.financeRole,
    context.actor.type === "student" ? context.actor.id : null,
    students,
    assets,
  );
  const dataQuality: FinanceStatisticsDataQuality = (
    reconciliation.mismatches.length === 0
    && reconciliation.pendingTransactionCount === 0
  ) ? "ok" : "attention";

  return {
    context: {
      financeRole: context.financeRole,
      actorType: context.actor.type,
      classId: context.classroom.id,
    },
    serverTime: now,
    currencyUnit: settings.currencyUnit,
    dataQuality,
    moneySupply: {
      metricType: "recorded_money_supply",
      current: current.total,
      walletBalance: current.walletBalance,
      depositPrincipal: current.depositPrincipal,
      fundingLocked: current.fundingLocked,
      previousMonthValue: previousMonth.monthValue,
      previousMonthEnd: change.previous,
      change: dataQuality === "ok" ? change.change : null,
      changeBps: dataQuality === "ok" ? change.changeBps : null,
      actualPriceInflationMeasured: false,
    },
    assets,
    distribution: projection.distribution,
    ...(projection.ownAsset ? { ownAsset: projection.ownAsset } : {}),
    ...(projection.students ? { students: projection.students } : {}),
  };
}

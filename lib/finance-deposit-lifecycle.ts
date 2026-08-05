import { database, ensureSchema } from "./database";
import { ApiError } from "./responses";

async function unsettledDepositCount(input: {
  classId: string;
  studentId?: string;
}) {
  await ensureSchema();
  const conditions = ["contract.class_id = ?", "settlement.id IS NULL"];
  const bindings = [input.classId];
  if (input.studentId) {
    conditions.push("contract.student_id = ?");
    bindings.push(input.studentId);
  }
  const row = await database().prepare(
    `SELECT COUNT(*) AS count
     FROM finance_deposit_contracts contract
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
     WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function activeStockHoldingCount(input: {
  classId: string;
  studentId?: string;
}) {
  await ensureSchema();
  const conditions = ["holding.class_id = ?", "holding.quantity > 0"];
  const bindings = [input.classId];
  if (input.studentId) {
    conditions.push("holding.student_id = ?");
    bindings.push(input.studentId);
  }
  const row = await database().prepare(
    `SELECT COUNT(*) AS count
     FROM finance_stock_holdings holding
     WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function activeFundingCampaignCount(input: {
  classId: string;
  studentId?: string;
}) {
  await ensureSchema();
  const conditions = [
    "campaign.class_id = ?",
    "campaign.status IN ('active', 'paused', 'funded', 'refunding')",
  ];
  const bindings = [input.classId];
  if (input.studentId) {
    conditions.push(`(
      campaign.creator_student_id = ? OR EXISTS (
        SELECT 1 FROM finance_funding_contributions contribution
        WHERE contribution.class_id = campaign.class_id
          AND contribution.campaign_id = campaign.id
          AND contribution.contributor_student_id = ?
      )
    )`);
    bindings.push(input.studentId, input.studentId);
  }
  const row = await database().prepare(
    `SELECT COUNT(*) AS count
     FROM finance_funding_campaigns campaign
     WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function pendingCashRequestCount(input: {
  classId: string;
  studentId?: string;
}) {
  await ensureSchema();
  const conditions = [
    "request_row.class_id = ?",
    `NOT EXISTS (
       SELECT 1 FROM finance_request_resolutions resolution
       WHERE resolution.request_id = request_row.id
         AND resolution.class_id = request_row.class_id
     )`,
  ];
  const bindings = [input.classId];
  if (input.studentId) {
    conditions.push("request_row.requester_student_id = ?");
    bindings.push(input.studentId);
  }
  const row = await database().prepare(
    `SELECT COUNT(*) AS count
     FROM finance_cash_requests request_row
     WHERE ${conditions.join(" AND ")}`,
  ).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function assertClassCanBeArchived(classId: string) {
  const pendingRequestCount = await pendingCashRequestCount({ classId });
  if (pendingRequestCount > 0) {
    throw new ApiError(
      409,
      `처리 대기 중인 입금·출금 신청 ${pendingRequestCount.toLocaleString("ko-KR")}건이 있어 학급을 아직 보관할 수 없습니다. 금융센터에서 승인하거나 거절한 뒤 다시 시도해 주세요.`,
      "FINANCE_REQUEST_PENDING_CLASS",
    );
  }
  if (await unsettledDepositCount({ classId }) > 0) {
    throw new ApiError(
      409,
      "진행 중인 예금이 있어 학급을 아직 보관할 수 없습니다. 학생들이 예금을 해지하거나 만기 지급을 받은 뒤 다시 시도해 주세요.",
      "FINANCE_DEPOSIT_ACTIVE_CLASS",
    );
  }
  if (await activeStockHoldingCount({ classId }) > 0) {
    throw new ApiError(
      409,
      "학생이 보유한 주식이 남아 있어 학급을 아직 보관할 수 없습니다. 학생들이 매도하거나 교사가 주식시장에서 비상 청산한 뒤 다시 시도해 주세요.",
      "FINANCE_STOCK_ACTIVE_CLASS",
    );
  }
  if (await activeFundingCampaignCount({ classId }) > 0) {
    throw new ApiError(
      409,
      "진행 중이거나 정산 중인 펀딩이 있어 학급을 아직 보관할 수 없습니다. 펀딩이 성공 또는 환불 완료된 뒤 다시 시도해 주세요.",
      "FINANCE_FUNDING_ACTIVE_CLASS",
    );
  }
}

export async function assertStudentCanBeExcluded(
  classId: string,
  studentId: string,
) {
  const pendingRequestCount = await pendingCashRequestCount({
    classId,
    studentId,
  });
  if (pendingRequestCount > 0) {
    throw new ApiError(
      409,
      `처리 대기 중인 입금·출금 신청 ${pendingRequestCount.toLocaleString("ko-KR")}건이 있어 이 학생을 명단에서 제외할 수 없습니다. 금융센터에서 승인하거나 거절한 뒤 다시 시도해 주세요.`,
      "FINANCE_REQUEST_PENDING_STUDENT",
    );
  }
  if (await unsettledDepositCount({ classId, studentId }) > 0) {
    throw new ApiError(
      409,
      "진행 중인 예금이 있어 이 학생을 명단에서 제외할 수 없습니다. 학생의 예금을 먼저 해지하거나 만기 지급해 주세요.",
      "FINANCE_DEPOSIT_ACTIVE_STUDENT",
    );
  }
  if (await activeStockHoldingCount({ classId, studentId }) > 0) {
    throw new ApiError(
      409,
      "이 학생이 보유한 주식이 남아 있어 명단에서 제외할 수 없습니다. 학생이 매도하거나 교사가 주식시장에서 비상 청산해 주세요.",
      "FINANCE_STOCK_ACTIVE_STUDENT",
    );
  }
  if (await activeFundingCampaignCount({ classId, studentId }) > 0) {
    throw new ApiError(
      409,
      "이 학생이 만든 펀딩 또는 참여한 펀딩이 진행 중이라 명단에서 제외할 수 없습니다. 펀딩 정산을 먼저 마쳐 주세요.",
      "FINANCE_FUNDING_ACTIVE_STUDENT",
    );
  }
}

export function mapFinanceDepositLifecycleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("FINANCE_REQUEST_PENDING_CLASS")) {
    throw new ApiError(
      409,
      "처리 대기 중인 입금·출금 신청이 있어 학급을 아직 보관할 수 없습니다. 금융센터에서 승인하거나 거절한 뒤 다시 시도해 주세요.",
      "FINANCE_REQUEST_PENDING_CLASS",
    );
  }
  if (message.includes("FINANCE_REQUEST_PENDING_STUDENT")) {
    throw new ApiError(
      409,
      "처리 대기 중인 입금·출금 신청이 있어 이 학생을 명단에서 제외할 수 없습니다. 금융센터에서 승인하거나 거절한 뒤 다시 시도해 주세요.",
      "FINANCE_REQUEST_PENDING_STUDENT",
    );
  }
  if (message.includes("FINANCE_DEPOSIT_ACTIVE_CLASS")) {
    throw new ApiError(
      409,
      "진행 중인 예금이 있어 학급을 아직 보관할 수 없습니다. 학생들이 예금을 해지하거나 만기 지급을 받은 뒤 다시 시도해 주세요.",
      "FINANCE_DEPOSIT_ACTIVE_CLASS",
    );
  }
  if (message.includes("FINANCE_DEPOSIT_ACTIVE_STUDENT")) {
    throw new ApiError(
      409,
      "진행 중인 예금이 있어 이 학생을 명단에서 제외할 수 없습니다. 학생의 예금을 먼저 해지하거나 만기 지급해 주세요.",
      "FINANCE_DEPOSIT_ACTIVE_STUDENT",
    );
  }
  if (message.includes("FINANCE_STOCK_ACTIVE_CLASS")) {
    throw new ApiError(
      409,
      "학생이 보유한 주식이 남아 있어 학급을 아직 보관할 수 없습니다. 학생들이 매도하거나 교사가 주식시장에서 비상 청산한 뒤 다시 시도해 주세요.",
      "FINANCE_STOCK_ACTIVE_CLASS",
    );
  }
  if (message.includes("FINANCE_STOCK_ACTIVE_STUDENT")) {
    throw new ApiError(
      409,
      "이 학생이 보유한 주식이 남아 있어 명단에서 제외할 수 없습니다. 학생이 매도하거나 교사가 주식시장에서 비상 청산해 주세요.",
      "FINANCE_STOCK_ACTIVE_STUDENT",
    );
  }
  if (message.includes("FINANCE_FUNDING_ACTIVE_CLASS")) {
    throw new ApiError(
      409,
      "진행 중이거나 정산 중인 펀딩이 있어 학급을 아직 보관할 수 없습니다. 펀딩 정산을 먼저 마쳐 주세요.",
      "FINANCE_FUNDING_ACTIVE_CLASS",
    );
  }
  if (message.includes("FINANCE_FUNDING_ACTIVE_STUDENT")) {
    throw new ApiError(
      409,
      "이 학생이 만든 펀딩 또는 참여한 펀딩이 진행 중이라 명단에서 제외할 수 없습니다. 펀딩 정산을 먼저 마쳐 주세요.",
      "FINANCE_FUNDING_ACTIVE_STUDENT",
    );
  }
  throw error;
}

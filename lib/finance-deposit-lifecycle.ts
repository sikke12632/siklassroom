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

export async function assertClassCanBeArchived(classId: string) {
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
}

export async function assertStudentCanBeExcluded(
  classId: string,
  studentId: string,
) {
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
}

export function mapFinanceDepositLifecycleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
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
  throw error;
}

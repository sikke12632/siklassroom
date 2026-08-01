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

export async function assertClassCanBeArchived(classId: string) {
  if (await unsettledDepositCount({ classId }) > 0) {
    throw new ApiError(
      409,
      "진행 중인 예금이 있어 학급을 아직 보관할 수 없습니다. 학생들이 예금을 해지하거나 만기 지급을 받은 뒤 다시 시도해 주세요.",
      "FINANCE_DEPOSIT_ACTIVE_CLASS",
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
  throw error;
}

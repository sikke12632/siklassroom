import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import {
  type MartRole,
  resolveMartRole,
} from "./mart-rules";
import { ApiError } from "./responses";

export type MartContext = {
  actor: FinanceContext["actor"];
  classroom: FinanceContext["classroom"];
  activeJob: FinanceContext["activeJob"];
  authorizationPeriodId?: string | null;
  operatorPermissionSource?: FinanceContext["operatorPermissionSource"];
  role: MartRole;
  permissions: {
    canOperate: boolean;
    canManageProducts: boolean;
    canAdjustInventory: boolean;
    canCancelSales: boolean;
    canEmergencyCorrect: boolean;
    canViewAllSales: boolean;
    canViewAudit: boolean;
    canViewStatistics: boolean;
  };
};

export async function martContextForRequest(request: Request): Promise<MartContext> {
  const context = await financeContextForRequest(request);
  const automaticPermission = context.activeJob?.templateId === "market-clerk";
  const manualPermission = context.manualPermissionKeys.includes("mart_operator");
  const role = resolveMartRole(
    context.actor.type,
    context.activeJob?.templateId,
    manualPermission,
  );
  const classIsActive = context.classroom.status === "active";
  return {
    actor: context.actor,
    classroom: context.classroom,
    activeJob: context.activeJob,
    authorizationPeriodId: context.permissionPeriodIds.mart_operator ?? null,
    operatorPermissionSource: context.actor.type === "teacher"
      ? null
      : automaticPermission && manualPermission
        ? "both"
        : automaticPermission
          ? "automatic"
          : manualPermission
            ? "manual"
            : null,
    role,
    permissions: {
      canOperate: classIsActive && (role === "teacher" || role === "market_clerk"),
      canManageProducts: classIsActive && (role === "teacher" || role === "market_clerk"),
      canAdjustInventory: classIsActive && (role === "teacher" || role === "market_clerk"),
      canCancelSales: classIsActive && (role === "teacher" || role === "market_clerk"),
      canEmergencyCorrect: classIsActive && role === "teacher",
      canViewAllSales: role === "teacher" || role === "market_clerk",
      canViewAudit: role === "teacher" || role === "market_clerk",
      canViewStatistics: role === "teacher" || role === "market_clerk",
    },
  };
}

export function martRequestWithClassId(request: Request, classId: unknown) {
  if (typeof classId !== "string" || !classId.trim()) return request;
  const url = new URL(request.url);
  url.searchParams.set("classId", classId.trim());
  return new Request(url, {
    method: request.method,
    headers: request.headers,
  });
}

export function assertMartOperator(context: MartContext) {
  if (context.classroom.status !== "active") {
    throw new ApiError(
      409,
      "보관한 학급에서는 마트를 변경할 수 없습니다.",
      "MART_CLASS_NOT_ACTIVE",
    );
  }
  if (!context.permissions.canOperate) {
    throw new ApiError(
      403,
      "현재 마트 직원 또는 담임교사만 처리할 수 있습니다.",
      "MART_OPERATOR_REQUIRED",
    );
  }
}

export function assertMartTeacher(context: MartContext) {
  assertMartOperator(context);
  if (context.role !== "teacher") {
    throw new ApiError(
      403,
      "이 비상 정정은 담임교사만 처리할 수 있습니다.",
      "MART_TEACHER_REQUIRED",
    );
  }
}

export function assertMartAuditReader(context: MartContext) {
  if (!context.permissions.canViewAudit) {
    throw new ApiError(
      403,
      "마트 운영 기록을 볼 권한이 없습니다.",
      "MART_AUDIT_ACCESS_DENIED",
    );
  }
}

export function martOperationActor(context: MartContext) {
  assertMartOperator(context);
  if (context.role === "teacher") {
    return {
      actorType: "teacher" as const,
      actorTeacherId: context.actor.id,
      actorStudentId: null,
      actorJobPeriodId: null,
      actorLabel: context.actor.name || "교사",
    };
  }
  if (!context.authorizationPeriodId) {
    throw new ApiError(
      403,
      "현재 효력이 있는 직업 운영 기간을 확인할 수 없습니다.",
      "MART_CLERK_ACCESS_DENIED",
    );
  }
  return {
    actorType: "market_clerk" as const,
    actorTeacherId: null,
    actorStudentId: context.actor.id,
    actorJobPeriodId: context.authorizationPeriodId,
    actorLabel: context.actor.name,
  };
}

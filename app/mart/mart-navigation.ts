import type { MartContext } from "./mart-api";

export type MartSection = "sale" | "products" | "inventory" | "records" | "statistics";

type MartNavigationContext = Pick<MartContext, "role" | "classroom" | "permissions">;

export function allowedMartSections(context: MartNavigationContext): MartSection[] {
  const canChange = context.classroom.status === "active"
    && context.role !== "student"
    && context.permissions.canOperate;

  return [
    ...(canChange ? ["sale" as const] : []),
    ...(canChange && context.permissions.canManageProducts ? ["products" as const] : []),
    ...(canChange && context.permissions.canAdjustInventory ? ["inventory" as const] : []),
    "records",
    ...(context.permissions.canViewStatistics ? ["statistics" as const] : []),
  ];
}

export function resolveMartSection(
  requested: MartSection,
  allowed: readonly MartSection[],
): MartSection {
  return allowed.includes(requested) ? requested : allowed[0] ?? "records";
}

export function martNavigationKey(context: MartNavigationContext): string {
  return [
    context.classroom.id,
    context.classroom.status,
    context.role,
    context.permissions.canOperate,
    context.permissions.canManageProducts,
    context.permissions.canAdjustInventory,
    context.permissions.canViewStatistics,
  ].join(":");
}

import { database } from "./database";
import type { StudentPermissionKey } from "./student-permission-rules";

export {
  STUDENT_PERMISSION_INFO,
  STUDENT_PERMISSION_KEYS,
  automaticPermissionForTemplate,
  parseStudentPermissionKey,
  permissionSource,
  type StudentPermissionKey,
  type StudentPermissionSource,
} from "./student-permission-rules";

export async function activeManualPermissionKeys(
  classId: string,
  studentId: string,
) {
  const rows = await database().prepare(
    `SELECT permission_key
     FROM student_manual_permissions
     WHERE class_id = ? AND student_id = ? AND is_active = 1`,
  ).bind(classId, studentId).all<{ permission_key: StudentPermissionKey }>();
  return new Set(rows.results.map((row) => row.permission_key));
}

export async function hasEffectiveStudentPermission(
  classId: string,
  studentId: string,
  permissionKey: StudentPermissionKey,
  periodId?: string | null,
) {
  const periodClause = periodId === undefined
    ? ""
    : " AND permission.period_id IS ?";
  const row = await database().prepare(
    `SELECT 1 AS allowed
     FROM student_effective_permissions permission
     WHERE permission.class_id = ?
       AND permission.student_id = ?
       AND permission.permission_key = ?${periodClause}
     LIMIT 1`,
  ).bind(
    classId,
    studentId,
    permissionKey,
    ...(periodId === undefined ? [] : [periodId]),
  ).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

export async function effectiveStudentPermissionPeriodIds(
  classId: string,
  studentId: string,
) {
  const rows = await database().prepare(
    `SELECT permission_key, period_id,
            MAX(permission_source = 'automatic') AS automatic_source
     FROM student_effective_permissions
     WHERE class_id = ? AND student_id = ? AND period_id IS NOT NULL
     GROUP BY permission_key, period_id
     ORDER BY automatic_source DESC, permission_key`,
  ).bind(classId, studentId).all<{
    permission_key: StudentPermissionKey;
    period_id: string;
    automatic_source: number;
  }>();
  const result: Partial<Record<StudentPermissionKey, string>> = {};
  for (const row of rows.results) {
    result[row.permission_key] ??= row.period_id;
  }
  return result;
}

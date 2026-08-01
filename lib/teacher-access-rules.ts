export type TeacherAccountIssue = "ACCOUNT_DISABLED" | "TEACHER_ACCESS_REVOKED" | null;

export function teacherAccountIssue(status: string, accessStatus: string): TeacherAccountIssue {
  if (status !== "active") return "ACCOUNT_DISABLED";
  if (accessStatus === "revoked") return "TEACHER_ACCESS_REVOKED";
  return null;
}

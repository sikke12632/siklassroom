import { requireClassManagement } from "@/lib/auth";
import { ownedActiveStudent } from "@/lib/authorization";
import { hashPassword } from "@/lib/crypto";
import { database, isOperationGuardFailure } from "@/lib/database";
import { subjectThrottleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { STUDENT_TEMPORARY_PASSWORD } from "@/lib/student-password";

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    await readJson<Record<string, never>>(request);
    const { studentId } = await context.params;
    await ownedActiveStudent(teacherId, studentId);
    const current = await database().prepare(
      `SELECT student.class_id, student.status, student.password_hash,
              student.credential_revision, student.qr_generation, student.updated_at
       FROM students student
       JOIN classes classroom ON classroom.id = student.class_id
       WHERE student.id = ? AND classroom.teacher_id = ? AND classroom.status = 'active'`,
    ).bind(studentId, teacherId).first<{
      class_id: string;
      status: string;
      password_hash: string | null;
      credential_revision: number;
      qr_generation: number;
      updated_at: number;
    }>();
    if (!current || (current.status !== "active" && current.status !== "reset_required") || !current.password_hash) {
      throw new ApiError(
        409,
        "비밀번호를 등록한 사용 중 학생만 초기화할 수 있어요.",
        "STUDENT_PASSWORD_RESET_NOT_AVAILABLE",
      );
    }

    const temporaryPasswordHash = await hashPassword(STUDENT_TEMPORARY_PASSWORD);
    const registrationThrottle = await subjectThrottleKey("registration-complete", studentId);
    const now = Date.now();
    const guardId = crypto.randomUUID();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM students student
             JOIN classes classroom ON classroom.id = student.class_id
             WHERE student.id = ? AND student.class_id = ?
               AND student.status = ? AND student.password_hash = ?
               AND student.credential_revision = ? AND student.qr_generation = ?
               AND student.updated_at = ?
               AND classroom.teacher_id = ? AND classroom.status = 'active'
           ) THEN ? ELSE NULL END, 'teacher_student_password_reset', ?`,
        ).bind(
          studentId,
          current.class_id,
          current.status,
          current.password_hash,
          current.credential_revision,
          current.qr_generation,
          current.updated_at,
          teacherId,
          guardId,
          now,
        ),
        database().prepare(
          `UPDATE students
           SET password_hash = ?, status = 'reset_required',
               credential_revision = credential_revision + 1, updated_at = ?
           WHERE id = ? AND class_id = ? AND status = ? AND password_hash = ?
             AND credential_revision = ? AND qr_generation = ? AND updated_at = ?`,
        ).bind(
          temporaryPasswordHash,
          now,
          studentId,
          current.class_id,
          current.status,
          current.password_hash,
          current.credential_revision,
          current.qr_generation,
          current.updated_at,
        ),
        database().prepare(
          `UPDATE registration_challenges SET revoked_at = ?
           WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        ).bind(now, studentId),
        database().prepare(
          `UPDATE student_qr_reset_grants SET revoked_at = ?
           WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        ).bind(now, studentId),
        database().prepare(`DELETE FROM sessions WHERE student_id = ?`).bind(studentId),
        database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(registrationThrottle),
        database().prepare(
          `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
           VALUES (?, ?, ?, ?, 'student_password_reset_by_teacher', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          teacherId,
          current.class_id,
          studentId,
          JSON.stringify({
            previousStatus: current.status,
            nextStatus: "reset_required",
            credentialRevision: current.credential_revision + 1,
          }),
          now,
        ),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(
          409,
          "다른 화면에서 학생 인증 정보가 먼저 바뀌었어요. 새로고침 후 다시 시도해 주세요.",
          "STUDENT_PASSWORD_RESET_STALE",
        );
      }
      throw error;
    }
    return json({ ok: true, status: "reset_required" });
  } catch (error) {
    return apiFailure(error);
  }
}

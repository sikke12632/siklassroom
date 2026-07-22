import { audit, database, ensureSchema } from "./database";
import { randomToken, sha256 } from "./crypto";
import { ApiError } from "./responses";

const TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export async function issueRegistrationToken(input: {
  studentId: string;
  teacherId: string;
  classId: string;
  purpose: "activate" | "reset";
}) {
  await ensureSchema();
  const student = await database().prepare(
    `SELECT qr_generation, status FROM students WHERE id = ? AND class_id = ?`,
  ).bind(input.studentId, input.classId).first<{ qr_generation: number; status: string }>();
  if (!student) throw new ApiError(404, "학생을 찾을 수 없습니다.", "STUDENT_NOT_FOUND");
  const now = Date.now();
  const generation = student.qr_generation + 1;
  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  await database().batch([
    database().prepare(`UPDATE registration_tokens SET revoked_at = ? WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`).bind(now, input.studentId),
    database().prepare(`UPDATE students SET qr_generation = ?, status = ?, updated_at = ? WHERE id = ?`).bind(
      generation,
      input.purpose === "reset" ? "reset_required" : student.status,
      now,
      input.studentId,
    ),
    database().prepare(
      `INSERT INTO registration_tokens (id, student_id, token_hash, purpose, generation, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.studentId, tokenHash, input.purpose, generation, now + TOKEN_LIFETIME_MS, now),
  ]);
  await audit({ action: `student_qr_${input.purpose}`, teacherId: input.teacherId, classId: input.classId, studentId: input.studentId, detail: { generation } });
  return rawToken;
}

export async function registrationRecord(rawToken: string) {
  await ensureSchema();
  const tokenHash = await sha256(rawToken);
  return database().prepare(
    `SELECT rt.id AS token_id, rt.student_id, rt.purpose, rt.generation, rt.expires_at,
            rt.used_at, rt.revoked_at, s.official_name, s.student_number, s.status,
            s.class_id, s.qr_generation, c.school_name, c.school_year, c.grade, c.class_number, c.display_name
     FROM registration_tokens rt
     JOIN students s ON s.id = rt.student_id
     JOIN classes c ON c.id = s.class_id
     WHERE rt.token_hash = ?`,
  ).bind(tokenHash).first<Record<string, string | number | null>>();
}

export function assertUsableRegistration(record: Record<string, string | number | null> | null) {
  if (!record || record.used_at || record.revoked_at || Number(record.expires_at) <= Date.now() || Number(record.generation) !== Number(record.qr_generation)) {
    throw new ApiError(410, "이 QR은 이미 사용되었거나 새 QR로 바뀌었어요. 선생님께 새 QR을 받아 주세요.", "QR_NOT_USABLE");
  }
  if (record.status === "locked" || record.status === "excluded") {
    throw new ApiError(403, "지금은 등록할 수 없는 계정이에요. 선생님께 알려 주세요.", "STUDENT_DISABLED");
  }
}

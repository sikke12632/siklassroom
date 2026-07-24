import { database, ensureSchema } from "./database";
import { ApiError } from "./responses";

export async function ownedClass(teacherId: string, classId: string) {
  await ensureSchema();
  const row = await database().prepare(
    `SELECT id, teacher_id, school_name, school_normalized, school_id, manual_school_request_id,
            school_year, grade, class_number, display_name, status, created_at, updated_at
     FROM classes WHERE id = ? AND teacher_id = ?`,
  ).bind(classId, teacherId).first<Record<string, string | number | null>>();
  if (!row) throw new ApiError(404, "학급을 찾을 수 없습니다.", "CLASS_NOT_FOUND");
  return row;
}

export async function ownedStudent(teacherId: string, studentId: string) {
  await ensureSchema();
  const row = await database().prepare(
    `SELECT s.id, s.class_id, s.student_number, s.official_name, s.status, s.qr_generation,
            s.activated_at, s.created_at, s.updated_at, c.teacher_id
     FROM students s JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND c.teacher_id = ?`,
  ).bind(studentId, teacherId).first<Record<string, string | number | null>>();
  if (!row) throw new ApiError(404, "학생을 찾을 수 없습니다.", "STUDENT_NOT_FOUND");
  return row;
}

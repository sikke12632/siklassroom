import { requireStudent } from "@/lib/auth";
import { database } from "@/lib/database";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    const { studentId } = await requireStudent(request);
    const student = await database().prepare(
      `SELECT s.id, s.official_name, s.student_number, c.id AS class_id, c.school_name, c.school_year,
              c.grade, c.class_number, c.display_name
       FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
    ).bind(studentId).first();
    return json({ student });
  } catch (error) {
    return apiFailure(error);
  }
}

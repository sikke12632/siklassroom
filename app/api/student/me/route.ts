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
    const currentJob = await database().prepare(
      `SELECT j.id, j.name, j.description, p.first_job_start_date, p.first_job_end_date,
              a.assignment_method, p.confirmed_at
       FROM student_job_assignments a
       JOIN class_job_assignment_periods p ON p.id = a.period_id
       JOIN class_jobs j ON j.id = a.class_job_id
       WHERE a.student_id = ? AND p.status = 'confirmed' AND p.assignment_type = 'initial'
       ORDER BY p.confirmed_at DESC LIMIT 1`,
    ).bind(studentId).first();
    return json({ student: student ? { ...student, current_job: currentJob ?? null } : null });
  } catch (error) {
    return apiFailure(error);
  }
}

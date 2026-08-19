import { requireStudent } from "@/lib/auth";
import { database } from "@/lib/database";
import { apiFailure, json } from "@/lib/responses";
import { seoulServerTime } from "@/lib/seoul-time";

export async function GET(request: Request) {
  try {
    const { studentId } = await requireStudent(request);
    const current = seoulServerTime();
    const student = await database().prepare(
      `SELECT s.id, s.official_name, s.student_number, c.id AS class_id, c.school_name, c.school_year,
              c.grade, c.class_number, c.display_name
       FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
    ).bind(studentId).first();
    const currentJobRow = await database().prepare(
      `WITH current_period AS (
         SELECT p.id, p.class_id, p.first_job_start_date, p.first_job_end_date,
                p.confirmed_at, p.assignment_year, p.assignment_month, p.assignment_type
         FROM class_job_assignment_periods p
         WHERE p.class_id = (SELECT class_id FROM students WHERE id = ?)
           AND p.status = 'confirmed'
           AND p.assignment_type IN ('initial', 'monthly')
           AND (
             p.assignment_year < ?
             OR (p.assignment_year = ? AND p.assignment_month <= ?)
           )
         ORDER BY p.assignment_year DESC, p.assignment_month DESC,
                  COALESCE(p.confirmed_at, 0) DESC, p.updated_at DESC, p.id DESC
         LIMIT 1
       )
       SELECT j.id, j.name, j.description, p.first_job_start_date, p.first_job_end_date,
              a.assignment_method, p.confirmed_at, p.assignment_year, p.assignment_month,
              p.assignment_type
       FROM current_period p
       JOIN student_job_assignments a
         ON a.period_id = p.id AND a.class_id = p.class_id AND a.student_id = ?
       JOIN class_jobs j
         ON j.id = a.class_job_id AND j.class_id = p.class_id AND j.is_active = 1`,
    ).bind(
      studentId,
      current.year,
      current.year,
      current.month,
      studentId,
    ).first<{
      id: string;
      name: string;
      description: string;
      first_job_start_date: string | null;
      first_job_end_date: string | null;
      assignment_method: "random" | "manual" | "choice";
      confirmed_at: number;
      assignment_year: number;
      assignment_month: number;
      assignment_type: string;
    }>();
    const currentJob = currentJobRow ? {
      id: currentJobRow.id,
      name: currentJobRow.name,
      description: currentJobRow.description,
      first_job_start_date: currentJobRow.first_job_start_date,
      first_job_end_date: currentJobRow.first_job_end_date,
      assignment_method: currentJobRow.assignment_method,
      confirmed_at: Number(currentJobRow.confirmed_at),
      assignmentYear: Number(currentJobRow.assignment_year),
      assignmentMonth: Number(currentJobRow.assignment_month),
      assignmentType: currentJobRow.assignment_type === "monthly" ? "monthly" : "initial",
    } : null;
    return json({ student: student ? { ...student, current_job: currentJob } : null });
  } catch (error) {
    return apiFailure(error);
  }
}

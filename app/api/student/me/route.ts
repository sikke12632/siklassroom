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
    const currentJobRow = await database().prepare(
      `SELECT j.id, j.name, j.description, p.first_job_start_date, p.first_job_end_date,
              a.assignment_method, p.confirmed_at, p.assignment_year, p.assignment_month,
              p.assignment_type
       FROM student_job_assignments a
       JOIN class_job_assignment_periods p ON p.id = a.period_id
       JOIN class_jobs j ON j.id = a.class_job_id
       WHERE a.student_id = ? AND p.status = 'confirmed'
         AND p.assignment_type IN ('initial', 'monthly')
       ORDER BY p.assignment_year DESC, p.assignment_month DESC, p.confirmed_at DESC LIMIT 1`,
    ).bind(studentId).first<{
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

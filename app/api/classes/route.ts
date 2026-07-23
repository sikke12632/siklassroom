import { requireTeacher } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
import { cleanDisplayText, currentSchoolYear, integerInRange, normalizeSchool } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    const { teacherId } = await requireTeacher(request);
    const result = await database().prepare(
      `SELECT c.id, c.school_name, c.school_year, c.grade, c.class_number, c.display_name, c.status,
              COUNT(s.id) AS student_count,
              SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN s.status IN ('pending','reset_required') THEN 1 ELSE 0 END) AS action_count,
              SUM(CASE WHEN s.id IS NOT NULL AND s.status <> 'excluded' THEN 1 ELSE 0 END) AS job_student_count,
              COALESCE(j.status, 'not_started') AS job_status,
              COALESCE(j.selected_job_count, 0) AS job_count,
              COALESCE(j.selected_capacity, 0) AS job_capacity,
              COALESCE(j.student_count_snapshot, 0) AS job_student_snapshot,
              CASE
                WHEN j.status IS NOT NULL
                  AND j.status <> 'not_started'
                  AND j.student_count_snapshot <> SUM(CASE WHEN s.id IS NOT NULL AND s.status <> 'excluded' THEN 1 ELSE 0 END)
                THEN 1 ELSE 0
              END AS job_student_count_changed
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id
       LEFT JOIN class_job_setup j ON j.class_id = c.id
       WHERE c.teacher_id = ? GROUP BY c.id ORDER BY c.school_year DESC, c.created_at DESC`,
    ).bind(teacherId).all();
    return json({ classes: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { teacherId } = await requireTeacher(request);
    const body = await readJson<{ schoolName?: string; schoolYear?: number; grade?: number; classNumber?: number; displayName?: string }>(request);
    const schoolName = cleanDisplayText(body.schoolName, 60);
    const schoolNormalized = normalizeSchool(schoolName);
    const schoolYear = integerInRange(body.schoolYear ?? currentSchoolYear(), 2020, 2100);
    const grade = integerInRange(body.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber, 1, 30);
    const displayName = cleanDisplayText(body.displayName, 40) || null;
    if (!schoolName || !schoolNormalized) throw new ApiError(400, "학교명을 입력해 주세요.", "SCHOOL_REQUIRED");
    if (!schoolYear || !grade || !classNumber) throw new ApiError(400, "학년도·학년·반을 다시 확인해 주세요.", "INVALID_CLASS_INFO");
    await ensureSchema();
    const duplicate = await database().prepare(
      `SELECT id FROM classes WHERE school_normalized = ? AND school_year = ? AND grade = ? AND class_number = ?`,
    ).bind(schoolNormalized, schoolYear, grade, classNumber).first();
    if (duplicate) throw new ApiError(409, "같은 학교의 같은 학년도·학년·반이 이미 만들어져 있어요.", "CLASS_EXISTS");
    const id = crypto.randomUUID();
    const now = Date.now();
    await database().prepare(
      `INSERT INTO classes (id, teacher_id, school_name, school_normalized, school_year, grade, class_number, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(id, teacherId, schoolName, schoolNormalized, schoolYear, grade, classNumber, displayName, now, now).run();
    await audit({ action: "class_created", teacherId, classId: id, detail: { schoolYear, grade, classNumber } });
    return json({ class: { id, school_name: schoolName, school_year: schoolYear, grade, class_number: classNumber, display_name: displayName, status: "active" } }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

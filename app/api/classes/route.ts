import { requireClassManagement } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
import { cleanDisplayText, currentSchoolYear, integerInRange, normalizeSchool } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { seoulServerTime } from "@/lib/seoul-time";

export async function GET(request: Request) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const current = seoulServerTime();
    const result = await database().prepare(
      `WITH clock AS (SELECT ? AS current_year, ? AS current_month)
       SELECT c.id, c.school_name, c.school_year, c.grade, c.class_number, c.display_name, c.status,
              COUNT(s.id) AS student_count,
              SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN s.status IN ('pending','reset_required') THEN 1 ELSE 0 END) AS action_count,
              SUM(CASE WHEN s.id IS NOT NULL AND s.status <> 'excluded' THEN 1 ELSE 0 END) AS job_student_count,
              COALESCE(j.status, 'not_started') AS job_status,
              COALESCE(j.selected_job_count, 0) AS job_count,
              COALESCE(j.selected_capacity, 0) AS job_capacity,
              COALESCE(j.student_count_snapshot, 0) AS job_student_snapshot,
              CASE WHEN EXISTS (
                SELECT 1 FROM class_calendars cc WHERE cc.class_id = c.id
              ) THEN 1 ELSE 0 END AS calendar_saved,
              COALESCE((
                SELECT p.status FROM class_job_assignment_periods p
                WHERE p.class_id = c.id AND p.assignment_type = 'initial'
                ORDER BY p.confirmed_at DESC, p.updated_at DESC LIMIT 1
              ), 'not_started') AS assignment_status,
              (
                SELECT choice.status FROM class_job_choice_sessions choice
                WHERE choice.class_id = c.id
                ORDER BY choice.updated_at DESC, choice.target_year DESC, choice.target_month DESC LIMIT 1
              ) AS monthly_choice_status,
              (
                SELECT choice.target_year FROM class_job_choice_sessions choice
                WHERE choice.class_id = c.id
                ORDER BY choice.updated_at DESC, choice.target_year DESC, choice.target_month DESC LIMIT 1
              ) AS monthly_choice_target_year,
              (
                SELECT choice.target_month FROM class_job_choice_sessions choice
                WHERE choice.class_id = c.id
                ORDER BY choice.updated_at DESC, choice.target_year DESC, choice.target_month DESC LIMIT 1
              ) AS monthly_choice_target_month,
              (
                SELECT evaluation.status FROM class_job_evaluation_sessions evaluation
                WHERE evaluation.class_id = c.id
                  AND evaluation.source_period_id = (
                    SELECT source.id FROM class_job_assignment_periods source
                    WHERE source.class_id = c.id AND source.status = 'confirmed'
                      AND source.assignment_type IN ('initial', 'monthly')
                      AND (
                        source.assignment_year < clock.current_year
                        OR (
                          source.assignment_year = clock.current_year
                          AND source.assignment_month <= clock.current_month
                        )
                      )
                    ORDER BY source.assignment_year DESC, source.assignment_month DESC,
                             source.confirmed_at DESC, source.updated_at DESC, source.id DESC
                    LIMIT 1
                  )
                LIMIT 1
              ) AS job_evaluation_status,
              (
                SELECT COUNT(*) FROM class_job_evaluation_responses response
                WHERE response.session_id = (
                  SELECT evaluation.id FROM class_job_evaluation_sessions evaluation
                  WHERE evaluation.class_id = c.id
                    AND evaluation.source_period_id = (
                      SELECT source.id FROM class_job_assignment_periods source
                      WHERE source.class_id = c.id AND source.status = 'confirmed'
                        AND source.assignment_type IN ('initial', 'monthly')
                        AND (
                          source.assignment_year < clock.current_year
                          OR (
                            source.assignment_year = clock.current_year
                            AND source.assignment_month <= clock.current_month
                          )
                        )
                      ORDER BY source.assignment_year DESC, source.assignment_month DESC,
                               source.confirmed_at DESC, source.updated_at DESC, source.id DESC
                      LIMIT 1
                    )
                  LIMIT 1
                )
              ) AS job_evaluation_submitted_count,
              (
                SELECT evaluation.student_count_snapshot FROM class_job_evaluation_sessions evaluation
                WHERE evaluation.class_id = c.id
                  AND evaluation.source_period_id = (
                    SELECT source.id FROM class_job_assignment_periods source
                    WHERE source.class_id = c.id AND source.status = 'confirmed'
                      AND source.assignment_type IN ('initial', 'monthly')
                      AND (
                        source.assignment_year < clock.current_year
                        OR (
                          source.assignment_year = clock.current_year
                          AND source.assignment_month <= clock.current_month
                        )
                      )
                    ORDER BY source.assignment_year DESC, source.assignment_month DESC,
                             source.confirmed_at DESC, source.updated_at DESC, source.id DESC
                    LIMIT 1
                  )
                LIMIT 1
              ) AS job_evaluation_student_count,
              CASE
                WHEN j.status IS NOT NULL
                  AND j.status <> 'not_started'
                  AND j.student_count_snapshot <> SUM(CASE WHEN s.id IS NOT NULL AND s.status <> 'excluded' THEN 1 ELSE 0 END)
                THEN 1 ELSE 0
              END AS job_student_count_changed
       FROM classes c
       CROSS JOIN clock
       LEFT JOIN students s ON s.class_id = c.id
       LEFT JOIN class_job_setup j ON j.class_id = c.id
       WHERE c.teacher_id = ? GROUP BY c.id ORDER BY c.school_year DESC, c.created_at DESC`,
    ).bind(current.year, current.month, teacherId).all();
    return json({ classes: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireClassManagement(request);
    const { teacherId } = access;
    const body = await readJson<{ schoolYear?: number; grade?: number; classNumber?: number; displayName?: string }>(request);
    const school = await database().prepare(
      `SELECT COALESCE(s.official_name, r.entered_name) AS school_name
       FROM teachers t
       LEFT JOIN schools s ON s.id = t.school_id
       LEFT JOIN school_manual_requests r ON r.id = t.manual_school_request_id
       WHERE t.id = ?`,
    ).bind(teacherId).first<{ school_name: string | null }>();
    const schoolName = cleanDisplayText(school?.school_name, 80);
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
      `INSERT INTO classes
       (id, teacher_id, school_name, school_normalized, school_id, manual_school_request_id,
        school_year, grade, class_number, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(
      id, teacherId, schoolName, schoolNormalized, access.schoolId, access.manualSchoolRequestId,
      schoolYear, grade, classNumber, displayName, now, now,
    ).run();
    await audit({ action: "class_created", teacherId, classId: id, detail: { schoolYear, grade, classNumber } });
    return json({ class: { id, school_name: schoolName, school_year: schoolYear, grade, class_number: classNumber, display_name: displayName, status: "active" } }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

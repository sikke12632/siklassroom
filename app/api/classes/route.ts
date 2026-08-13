import { requireClassManagement } from "@/lib/auth";
import { database, ensureSchema, isOperationGuardFailure } from "@/lib/database";
import {
  MAX_ACTIVE_CLASSES_PER_TEACHER,
  MAX_TOTAL_CLASSES_PER_TEACHER,
} from "@/lib/class-limits";
import { cleanDisplayText, currentSchoolYear, integerInRange, normalizeSchool } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { seoulServerTime } from "@/lib/seoul-time";

async function assertTeacherClassCapacity(teacherId: string) {
  const counts = await database().prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count
     FROM classes WHERE teacher_id = ?`,
  ).bind(teacherId).first<{ total_count: number; active_count: number | null }>();
  if (Number(counts?.active_count ?? 0) >= MAX_ACTIVE_CLASSES_PER_TEACHER) {
    throw new ApiError(409, "사용 중인 학급은 최대 10개까지 만들 수 있어요. 쓰지 않는 학급을 먼저 보관해 주세요.", "ACTIVE_CLASS_LIMIT_REACHED");
  }
  if (Number(counts?.total_count ?? 0) >= MAX_TOTAL_CLASSES_PER_TEACHER) {
    throw new ApiError(409, "학급 기록이 50개에 도달했어요. 관리자에게 정리를 요청해 주세요.", "CLASS_LIMIT_REACHED");
  }
}

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
    if (!access.schoolId) {
      throw new ApiError(
        409,
        "직접 입력한 학교는 관리자 확인이 끝난 뒤 학급을 만들 수 있어요.",
        "SCHOOL_APPROVAL_REQUIRED",
      );
    }
    const body = await readJson<{ schoolYear?: number; grade?: number; classNumber?: number; displayName?: string }>(request);
    const school = await database().prepare(
      `SELECT official_name AS school_name
       FROM schools
       WHERE id = ? AND status = 'active'`,
    ).bind(access.schoolId).first<{ school_name: string | null }>();
    const schoolName = cleanDisplayText(school?.school_name, 80);
    const schoolNormalized = normalizeSchool(schoolName);
    const schoolYear = integerInRange(body.schoolYear ?? currentSchoolYear(), 2020, 2100);
    const grade = integerInRange(body.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber, 1, 30);
    const displayName = cleanDisplayText(body.displayName, 40) || null;
    if (!schoolName || !schoolNormalized) throw new ApiError(400, "학교명을 입력해 주세요.", "SCHOOL_REQUIRED");
    if (!schoolYear || !grade || !classNumber) throw new ApiError(400, "학년도·학년·반을 다시 확인해 주세요.", "INVALID_CLASS_INFO");
    await ensureSchema();
    await assertTeacherClassCapacity(teacherId);
    const duplicate = await database().prepare(
      `SELECT id FROM classes WHERE school_normalized = ? AND school_year = ? AND grade = ? AND class_number = ?`,
    ).bind(schoolNormalized, schoolYear, grade, classNumber).first();
    if (duplicate) throw new ApiError(409, "같은 학교의 같은 학년도·학년·반이 이미 만들어져 있어요.", "CLASS_EXISTS");
    const id = crypto.randomUUID();
    const guardId = crypto.randomUUID();
    const now = Date.now();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM classes
             WHERE school_normalized = ? AND school_year = ? AND grade = ? AND class_number = ?
           ) AND EXISTS (
             SELECT 1 FROM teachers teacher
             JOIN schools school ON school.id = teacher.school_id
             WHERE teacher.id = ? AND teacher.status = 'active'
               AND teacher.teacher_access_status = 'invite_verified'
               AND teacher.school_id = ? AND teacher.manual_school_request_id IS NULL
               AND school.status = 'active'
           ) AND (SELECT COUNT(*) FROM classes WHERE teacher_id = ? AND status = 'active') < ?
             AND (SELECT COUNT(*) FROM classes WHERE teacher_id = ?) < ?
           THEN ? ELSE NULL END, 'class_create', ?`,
        ).bind(
          schoolNormalized, schoolYear, grade, classNumber,
          teacherId, access.schoolId,
          teacherId, MAX_ACTIVE_CLASSES_PER_TEACHER,
          teacherId, MAX_TOTAL_CLASSES_PER_TEACHER,
          guardId, now,
        ),
        database().prepare(
          `INSERT INTO classes
           (id, teacher_id, school_name, school_normalized, school_id, manual_school_request_id,
            school_year, grade, class_number, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        ).bind(
          id, teacherId, schoolName, schoolNormalized, access.schoolId, access.manualSchoolRequestId,
          schoolYear, grade, classNumber, displayName, now, now,
        ),
        database().prepare(
          `INSERT INTO audit_logs (
             id, teacher_id, class_id, student_id, action, detail, created_at
           ) VALUES (?, ?, ?, NULL, 'class_created', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          teacherId,
          id,
          JSON.stringify({ schoolYear, grade, classNumber }),
          now,
        ),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        const latestAccess = await database().prepare(
          `SELECT teacher.school_id, teacher.manual_school_request_id,
                  teacher.status, teacher.teacher_access_status,
                  school.status AS school_status
           FROM teachers teacher
           LEFT JOIN schools school ON school.id = teacher.school_id
           WHERE teacher.id = ?`,
        ).bind(teacherId).first<{
          school_id: string | null;
          manual_school_request_id: string | null;
          status: string;
          teacher_access_status: string;
          school_status: string | null;
        }>();
        if (
          latestAccess?.school_id !== access.schoolId
          || latestAccess.manual_school_request_id !== null
          || latestAccess.status !== "active"
          || latestAccess.teacher_access_status !== "invite_verified"
          || latestAccess.school_status !== "active"
        ) {
          throw new ApiError(
            409,
            "학교 또는 이용 권한이 바뀌었어요. 최신 화면을 불러온 뒤 학급을 다시 만들어 주세요.",
            "CLASS_CONTEXT_STALE",
          );
        }
        await assertTeacherClassCapacity(teacherId);
        throw new ApiError(409, "같은 학교의 같은 학년도·학년·반이 이미 만들어져 있어요.", "CLASS_EXISTS");
      }
      throw error;
    }
    return json({ class: { id, school_name: schoolName, school_year: schoolYear, grade, class_number: classNumber, display_name: displayName, status: "active" } }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

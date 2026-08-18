import { database, ensureSchema } from "./database";

export { DEFAULT_STUDENT_SCHOOL_CODE, normalizeStudentSchoolCode } from "./student-login-rules";

export type StudentLoginCandidate = {
  id: string;
  class_id: string;
  password_hash: string | null;
  status: string;
  credential_revision: number;
  qr_generation: number;
  school_year: number;
};

export type StudentLoginResolution = {
  candidate: StudentLoginCandidate | null;
  ambiguous: boolean;
};

/**
 * Resolve the current active class without asking a child for the school year.
 * The newest active school year wins for now. Keeping this policy in one place
 * lets the planned March rollover rule replace it without changing login input
 * or student account identifiers.
 */
export async function resolveStudentLogin(input: {
  schoolCode: string;
  grade: number;
  classNumber: number;
  studentNumber: number;
}): Promise<StudentLoginResolution> {
  await ensureSchema();
  const rows = await database().prepare(
    `WITH eligible_classes AS (
       SELECT classroom.id, classroom.school_year
       FROM schools school
       JOIN classes classroom ON (
         classroom.school_id = school.id
         OR (
           classroom.school_id IS NULL
           AND (
             classroom.school_normalized = school.normalized_name
             OR EXISTS (
               SELECT 1 FROM school_aliases alias
               WHERE alias.school_id = school.id
                 AND alias.normalized_alias = classroom.school_normalized
             )
           )
         )
       )
       WHERE school.student_login_code = ? AND school.status = 'active'
         AND classroom.status = 'active'
         AND classroom.grade = ? AND classroom.class_number = ?
     ), current_classes AS (
       SELECT id, school_year
       FROM eligible_classes
       WHERE school_year = (SELECT MAX(school_year) FROM eligible_classes)
     )
     SELECT classroom.id AS class_id, classroom.school_year,
            student.id, student.password_hash, student.status,
            student.credential_revision, student.qr_generation
     FROM current_classes classroom
     LEFT JOIN students student
       ON student.class_id = classroom.id AND student.student_number = ?
     ORDER BY classroom.id
     LIMIT 2`,
  ).bind(
    input.schoolCode,
    input.grade,
    input.classNumber,
    input.studentNumber,
  ).all<{
    class_id: string;
    school_year: number;
    id: string | null;
    password_hash: string | null;
    status: string | null;
    credential_revision: number | null;
    qr_generation: number | null;
  }>();

  if (rows.results.length !== 1) {
    return { candidate: null, ambiguous: rows.results.length > 1 };
  }
  const row = rows.results[0];
  if (!row.id || row.status === null) return { candidate: null, ambiguous: false };
  return {
    ambiguous: false,
    candidate: {
      id: row.id,
      class_id: row.class_id,
      password_hash: row.password_hash,
      status: row.status,
      credential_revision: Number(row.credential_revision ?? 0),
      qr_generation: Number(row.qr_generation ?? 0),
      school_year: Number(row.school_year),
    },
  };
}

import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { database } from "@/lib/database";
import { randomToken, sha256 } from "@/lib/crypto";
import { cleanDisplayText, integerInRange } from "@/lib/identity";
import { REGISTRATION_QR_LIFETIME_MS, registrationActivationUrl } from "@/lib/registration";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

type StudentInput = { number?: number; name?: string };

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const result = await database().prepare(
      `SELECT id, student_number, official_name, status, qr_generation, activated_at, created_at, updated_at
       FROM students WHERE class_id = ? ORDER BY student_number ASC`,
    ).bind(classId).all();
    return json({ class: classRoom, students: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{ students?: StudentInput[] }>(request);
    const source = Array.isArray(body.students) ? body.students : [];
    if (!source.length || source.length > 60) throw new ApiError(400, "학생을 1명 이상, 60명 이하로 입력해 주세요.", "INVALID_STUDENT_COUNT");
    const rows = source.map((item, index) => {
      const studentNumber = integerInRange(item.number, 1, 99);
      const officialName = cleanDisplayText(item.name, 30);
      if (!studentNumber) throw new ApiError(400, `${index + 1}번째 학생의 번호를 1~99 사이로 입력해 주세요.`, "INVALID_STUDENT_NUMBER");
      if (!officialName) throw new ApiError(400, `${studentNumber}번 학생의 이름을 입력해 주세요.`, "STUDENT_NAME_REQUIRED");
      return { studentNumber, officialName };
    });
    const duplicateNumbers = [...new Set(rows.filter((row, index) => rows.findIndex((other) => other.studentNumber === row.studentNumber) !== index).map((row) => row.studentNumber))];
    if (duplicateNumbers.length) throw new ApiError(409, `${duplicateNumbers.join(", ")}번이 두 번 입력되었어요.`, "DUPLICATE_STUDENT_NUMBER");
    const existing = await database().prepare(`SELECT student_number FROM students WHERE class_id = ?`).bind(classId).all<{ student_number: number }>();
    const existingNumbers = new Set(existing.results.map((row) => row.student_number));
    const conflicts = rows.filter((row) => existingNumbers.has(row.studentNumber)).map((row) => row.studentNumber);
    if (conflicts.length) throw new ApiError(409, `${conflicts.join(", ")}번 학생은 이미 명단에 있어요.`, "STUDENT_NUMBER_EXISTS");

    const now = Date.now();
    const issued = await Promise.all(rows.map(async (row) => {
      const id = crypto.randomUUID();
      const rawToken = randomToken(32);
      return { ...row, id, rawToken, tokenHash: await sha256(rawToken) };
    }));
    const statements: D1PreparedStatement[] = [];
    for (const row of issued) {
      statements.push(database().prepare(
        `INSERT INTO students (id, class_id, student_number, official_name, status, qr_generation, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`,
      ).bind(row.id, classId, row.studentNumber, row.officialName, now, now));
      statements.push(database().prepare(
        `INSERT INTO registration_tokens (id, student_id, token_hash, purpose, generation, expires_at, created_at)
         VALUES (?, ?, ?, 'activate', 1, ?, ?)`,
      ).bind(crypto.randomUUID(), row.id, row.tokenHash, now + REGISTRATION_QR_LIFETIME_MS, now));
    }
    statements.push(database().prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       ) VALUES (?, ?, ?, NULL, 'students_bulk_created', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      teacherId,
      classId,
      JSON.stringify({ count: issued.length }),
      now,
    ));
    await database().batch(statements);
    const origin = new URL(request.url).origin;
    return json({
      students: issued.map((row) => ({
        id: row.id,
        student_number: row.studentNumber,
        official_name: row.officialName,
        status: "pending",
        activation_url: registrationActivationUrl(origin, row.rawToken),
      })),
    }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

import { requireClassManagement, requireTeacher } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit, database } from "@/lib/database";
import { cleanDisplayText, integerInRange } from "@/lib/identity";
import {
  assertClassCanBeArchived,
  mapFinanceDepositLifecycleError,
} from "@/lib/finance-deposit-lifecycle";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    return json({ class: classRoom });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { classId } = await context.params;
    const current = await ownedClass(teacherId, classId);
    const body = await readJson<{ schoolYear?: number; grade?: number; classNumber?: number; displayName?: string; status?: string }>(request);
    const schoolName = String(current.school_name);
    const schoolNormalized = String(current.school_normalized);
    const schoolYear = integerInRange(body.schoolYear ?? current.school_year, 2020, 2100);
    const grade = integerInRange(body.grade ?? current.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber ?? current.class_number, 1, 30);
    const displayName = cleanDisplayText(body.displayName ?? current.display_name, 40) || null;
    const status = body.status === "archived" ? "archived" : "active";
    if (!schoolName || !schoolYear || !grade || !classNumber) throw new ApiError(400, "학급 정보를 다시 확인해 주세요.", "INVALID_CLASS_INFO");
    const duplicate = await database().prepare(
      `SELECT id FROM classes WHERE school_normalized = ? AND school_year = ? AND grade = ? AND class_number = ? AND id != ?`,
    ).bind(schoolNormalized, schoolYear, grade, classNumber, classId).first();
    if (duplicate) throw new ApiError(409, "같은 학교의 같은 학년도·학년·반이 이미 있어요.", "CLASS_EXISTS");
    if (status === "archived" && current.status !== "archived") {
      await assertClassCanBeArchived(classId);
    }
    try {
      await database().prepare(
        `UPDATE classes SET school_name = ?, school_normalized = ?, school_year = ?, grade = ?, class_number = ?, display_name = ?, status = ?, updated_at = ? WHERE id = ?`,
      ).bind(schoolName, schoolNormalized, schoolYear, grade, classNumber, displayName, status, Date.now(), classId).run();
    } catch (error) {
      mapFinanceDepositLifecycleError(error);
    }
    await audit({ action: "class_updated", teacherId, classId, detail: { status } });
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}

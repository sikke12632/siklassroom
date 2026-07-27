import { assertUsableRegistration, registrationRecord } from "@/lib/registration";
import { ApiError, apiFailure, json } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (token.length < 32) throw new ApiError(400, "QR 주소가 올바르지 않아요.", "INVALID_QR");
    const record = await registrationRecord(token);
    assertUsableRegistration(record);
    return json({
      student: {
        official_name: record!.official_name,
        student_number: record!.student_number,
        school_name: record!.school_name,
        school_year: record!.school_year,
        grade: record!.grade,
        class_number: record!.class_number,
        display_name: record!.display_name,
      },
      purpose: record!.purpose,
      isReturning: record!.status === "active" || record!.status === "reset_required",
    });
  } catch (error) {
    return apiFailure(error);
  }
}

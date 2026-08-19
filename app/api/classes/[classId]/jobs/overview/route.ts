import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { loadJobOverview } from "@/lib/job-configurations";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    return json(await loadJobOverview(classId), 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    return apiFailure(error);
  }
}

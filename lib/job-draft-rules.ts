import { cleanDisplayText, integerInRange } from "./identity";
import {
  JOB_CATEGORIES,
  JOB_TEMPLATES,
  type ClassJobDraft,
  type JobCategory,
} from "./job-catalog";
import { ApiError } from "./responses";

export function jobIdBelongsToClass(jobId: string, classId: string) {
  return jobId.startsWith(`${classId}:`);
}

export function jobIdOwnedOrAvailableForClass(
  jobId: string,
  classId: string,
  existingClassId: string | null,
) {
  return existingClassId === null
    ? jobIdBelongsToClass(jobId, classId)
    : existingClassId === classId;
}

export function scopeAdjustedJobIds(
  classId: string,
  inputJobs: ClassJobDraft[],
  adjustedJobs: ClassJobDraft[],
  createId: () => string = () => crypto.randomUUID(),
) {
  const inputIds = new Set(inputJobs.map((job) => job.id));
  return adjustedJobs.map((job) => {
    if (inputIds.has(job.id) || jobIdBelongsToClass(job.id, classId)) return job;
    return {
      ...job,
      id: job.templateId
        ? `${classId}:${job.templateId}`
        : `${classId}:custom:${createId()}`,
    };
  });
}

export function validateJobDrafts(
  input: unknown,
  options: { allowEmpty?: boolean; classId?: string } = {},
) {
  if (!Array.isArray(input)) throw new ApiError(400, "직업 목록을 다시 확인해 주세요.", "INVALID_JOBS");
  if (!options.allowEmpty && input.length === 0) {
    throw new ApiError(400, "직업을 한 개 이상 추가해 주세요.", "JOB_REQUIRED");
  }
  if (input.length > 60) throw new ApiError(400, "직업은 최대 60개까지 만들 수 있어요.", "TOO_MANY_JOBS");

  const seen = new Set<string>();
  return input.map((raw, index): ClassJobDraft => {
    const item = (raw ?? {}) as Partial<ClassJobDraft>;
    const id = cleanDisplayText(item.id, 100);
    if (!id || seen.has(id)) throw new ApiError(400, "직업 ID가 없거나 중복되었어요.", "INVALID_JOB_ID");
    if (options.classId && !jobIdBelongsToClass(id, options.classId)) {
      throw new ApiError(
        400,
        "현재 학급에서 만든 직업만 저장할 수 있어요.",
        "JOB_ID_CLASS_MISMATCH",
      );
    }
    seen.add(id);
    const name = cleanDisplayText(item.name, 40);
    const description = cleanDisplayText(item.description, 240);
    const memberCapacity = integerInRange(item.memberCapacity, 1, 60);
    const category = String(item.category ?? "") as JobCategory;
    const source = String(item.source ?? "") as ClassJobDraft["source"];
    const templateId = item.templateId ? cleanDisplayText(item.templateId, 80) : null;
    if (!name || !description || !memberCapacity) {
      throw new ApiError(400, `${index + 1}번째 직업의 이름, 설명, 정원을 확인해 주세요.`, "INVALID_JOB");
    }
    if (!(category in JOB_CATEGORIES)) {
      throw new ApiError(400, `${name}의 분류를 다시 선택해 주세요.`, "INVALID_JOB_CATEGORY");
    }
    if (!["recommended", "template", "custom"].includes(source)) {
      throw new ApiError(400, `${name}의 생성 방식을 확인해 주세요.`, "INVALID_JOB_SOURCE");
    }
    if (templateId && !JOB_TEMPLATES.some((template) => template.id === templateId)) {
      throw new ApiError(400, `${name}의 기본 직업을 찾을 수 없어요.`, "INVALID_TEMPLATE");
    }
    return {
      id,
      templateId,
      name,
      description,
      memberCapacity,
      category,
      source,
      sortOrder: index,
    };
  });
}

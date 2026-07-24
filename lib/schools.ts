import { cleanDisplayText, normalizeSchool } from "./identity";
import { ApiError } from "./responses";

export const PROVINCES = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
  "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
  "경상남도", "제주특별자치도",
] as const;

export const SCHOOL_LEVELS = ["초등학교", "중학교", "고등학교", "특수학교", "각종학교"] as const;

const LEVEL_SUFFIXES = [
  ["초등학교", "초"],
  ["중학교", "중"],
  ["고등학교", "고"],
] as const;

export function normalizeSchoolSearch(value: unknown): string {
  let normalized = normalizeSchool(value).replace(/[()\-·.,]/g, "");
  for (const [full, short] of LEVEL_SUFFIXES) {
    if (normalized.endsWith(full)) normalized = `${normalized.slice(0, -full.length)}${short}`;
  }
  return normalized;
}

export function schoolSearchVariants(name: string): string[] {
  const normalized = normalizeSchool(name);
  const search = normalizeSchoolSearch(name);
  return [...new Set([normalized, search].filter(Boolean))];
}

export function validatedSchoolLevel(value: unknown): string {
  const level = cleanDisplayText(value, 20);
  if (!(SCHOOL_LEVELS as readonly string[]).includes(level)) {
    throw new ApiError(400, "학교급을 다시 선택해 주세요.", "INVALID_SCHOOL_LEVEL");
  }
  return level;
}

export function validatedProvince(value: unknown): string {
  const province = cleanDisplayText(value, 30);
  if (!(PROVINCES as readonly string[]).includes(province) && province !== "미지정") {
    throw new ApiError(400, "시도를 다시 선택해 주세요.", "INVALID_PROVINCE");
  }
  return province;
}

export function manualSchoolInput(input: {
  enteredName?: unknown;
  provinceName?: unknown;
  schoolLevel?: unknown;
  districtOrAddress?: unknown;
  note?: unknown;
}) {
  const enteredName = cleanDisplayText(input.enteredName, 80);
  if (enteredName.length < 2 || /[<>{}\\]/.test(enteredName)) {
    throw new ApiError(400, "학교명을 2자 이상 정확히 입력해 주세요.", "INVALID_SCHOOL_NAME");
  }
  const districtOrAddress = cleanDisplayText(input.districtOrAddress, 120);
  const note = cleanDisplayText(input.note, 300);
  if (/[<>{}\\]/.test(districtOrAddress) || /[<>{}\\]/.test(note)) {
    throw new ApiError(400, "학교 설명에 사용할 수 없는 문자가 있습니다.", "INVALID_SCHOOL_DETAIL");
  }
  return {
    enteredName,
    normalizedName: normalizeSchool(enteredName),
    provinceName: validatedProvince(input.provinceName),
    schoolLevel: validatedSchoolLevel(input.schoolLevel),
    districtOrAddress: districtOrAddress || null,
    note: note || null,
  };
}

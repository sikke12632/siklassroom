export const STUDENT_PERMISSION_KEYS = [
  "finance_banker",
  "mart_operator",
  "life_check_tooth",
  "life_check_milk",
  "life_check_lunch",
] as const;

export type StudentPermissionKey = typeof STUDENT_PERMISSION_KEYS[number];
export type StudentPermissionSource = "automatic" | "manual" | "both" | null;

export const STUDENT_PERMISSION_INFO: Record<StudentPermissionKey, {
  label: string;
  description: string;
}> = {
  finance_banker: {
    label: "은행 운영",
    description: "입출금 신청을 확인하고 처리할 수 있어요.",
  },
  mart_operator: {
    label: "마트 운영",
    description: "상품·재고·판매 기록을 관리할 수 있어요.",
  },
  life_check_tooth: {
    label: "양치 확인 기록",
    description: "우리 반 양치 확인 결과를 기록할 수 있어요.",
  },
  life_check_milk: {
    label: "우유 확인 기록",
    description: "우리 반 우유 확인 결과를 기록할 수 있어요.",
  },
  life_check_lunch: {
    label: "급식 확인 기록",
    description: "우리 반 급식 확인 결과를 기록할 수 있어요.",
  },
};

const TEMPLATE_PERMISSION: Record<string, StudentPermissionKey | undefined> = {
  banker: "finance_banker",
  "market-clerk": "mart_operator",
  "routine-checker": "life_check_tooth",
  "milk-manager": "life_check_milk",
  "meal-checker": "life_check_lunch",
};

export function parseStudentPermissionKey(value: unknown): StudentPermissionKey | null {
  return typeof value === "string"
    && STUDENT_PERMISSION_KEYS.includes(value as StudentPermissionKey)
      ? value as StudentPermissionKey
      : null;
}

export function automaticPermissionForTemplate(
  templateId: string | null | undefined,
): StudentPermissionKey | null {
  return templateId ? TEMPLATE_PERMISSION[templateId] ?? null : null;
}

export function permissionSource(input: {
  automatic: boolean;
  manual: boolean;
}): StudentPermissionSource {
  if (input.automatic && input.manual) return "both";
  if (input.automatic) return "automatic";
  if (input.manual) return "manual";
  return null;
}

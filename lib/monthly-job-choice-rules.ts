export type JobGrade = "A" | "B" | "C";
export type PreviousChoiceGrade = JobGrade | "D" | "NEW";

export type ChoiceOrderItem = {
  studentId: string;
  studentNumber: number;
  studentName: string;
  previousJobName: string | null;
  previousGrade: PreviousChoiceGrade;
};

export type JobGradeSource = {
  templateId?: string | null;
  name: string;
};

const GRADE_RANK: Record<PreviousChoiceGrade, number> = {
  C: 0,
  B: 1,
  A: 2,
  NEW: 3,
  D: 4,
};

const A_TEMPLATE_IDS = new Set(["banker", "market-clerk", "device-manager"]);
const C_TEMPLATE_IDS = new Set([
  "classroom-cleaner",
  "recycling-manager",
  "milk-manager",
  "board-schedule-manager",
]);

function normalizedJobIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·&/()_-]/g, "");
}

export function nextJobMonth(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("올바른 연도와 월이 필요합니다.");
  }
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

export function sortChoiceOrder<T extends ChoiceOrderItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const gradeDifference = GRADE_RANK[left.previousGrade] - GRADE_RANK[right.previousGrade];
    if (gradeDifference !== 0) return gradeDifference;
    const numberDifference = Number(left.studentNumber) - Number(right.studentNumber);
    if (numberDifference !== 0) return numberDifference;
    const nameDifference = left.studentName.localeCompare(right.studentName, "ko");
    if (nameDifference !== 0) return nameDifference;
    return left.studentId.localeCompare(right.studentId);
  });
}

export function suggestJobGrade(input: JobGradeSource | string, name = ""): JobGrade {
  const source = typeof input === "string"
    ? { templateId: input, name }
    : input;
  const templateId = normalizedJobIdentity(source.templateId);
  const jobName = normalizedJobIdentity(source.name);

  if (
    A_TEMPLATE_IDS.has(templateId)
    || jobName.includes("은행원")
    || jobName.includes("마트직원")
    || jobName.includes("기기관리원")
    || jobName.includes("디지털기기관리원")
  ) {
    return "A";
  }
  if (
    C_TEMPLATE_IDS.has(templateId)
    || jobName.includes("환경미화원")
    || jobName.includes("재활용관리원")
    || jobName.includes("분리수거원")
    || jobName.includes("우유관리원")
    || jobName.includes("칠판시간표관리원")
  ) {
    return "C";
  }
  return "B";
}

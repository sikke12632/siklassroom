export const JOB_CATEGORIES = {
  cleaning: "청소·환경",
  life: "생활·확인",
  learning: "학습·수업",
  economy: "경제",
  facilities: "물품·시설",
  records: "기록·행사",
} as const;

export type JobCategory = keyof typeof JOB_CATEGORIES;
export type SetupMode = "recommended" | "manual";
export type DistributionPreference = "shared" | "diverse" | "balanced";

export type JobTemplate = {
  id: string;
  name: string;
  shortDescription: string;
  detailedTasks: string;
  category: JobCategory;
  recommendedMinMembers: number;
  recommendedMaxMembers: number;
  iconKey: string;
  defaultPriority: number;
};

export type SurveyAnswers = {
  areas: string[];
  economy: "both" | "mart" | "bank" | "none" | "later";
  checks: string[];
  distribution: DistributionPreference;
  includeJobIds: string[];
  excludeJobIds: string[];
};

export type ClassJobDraft = {
  id: string;
  templateId: string | null;
  name: string;
  description: string;
  memberCapacity: number;
  category: JobCategory;
  source: "recommended" | "template" | "custom";
  sortOrder: number;
};

export type JobPlanResult = {
  jobs: ClassJobDraft[];
  reasons: string[];
};

export const DEFAULT_SURVEY_ANSWERS: SurveyAnswers = {
  areas: [],
  economy: "later",
  checks: [],
  distribution: "balanced",
  includeJobIds: [],
  excludeJobIds: [],
};

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: "classroom-cleaner",
    name: "교실 환경미화원",
    shortDescription: "맡은 공용구역과 책상, 교실 환경을 깨끗하게 유지해요.",
    detailedTasks: "개인 청소뿐 아니라 맡은 공용구역을 정리하고 책상과 교실 환경을 깨끗하게 유지해요.",
    category: "cleaning", recommendedMinMembers: 3, recommendedMaxMembers: 6, iconKey: "broom", defaultPriority: 1,
  },
  {
    id: "milk-manager",
    name: "우유 관리원",
    shortDescription: "우유를 나누고 남은 우유와 우유팩을 정리해요.",
    detailedTasks: "우유를 가져와 나누어 주고, 남은 우유와 우유팩을 빠짐없이 정리해요.",
    category: "life", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "milk", defaultPriority: 11,
  },
  {
    id: "market-clerk",
    name: "마트 직원",
    shortDescription: "학급 마트의 판매와 가격·재고 기록을 확인해요.",
    detailedTasks: "학급 마트에서 물건을 판매하고 가격·재고·판매 기록을 확인해요.",
    category: "economy", recommendedMinMembers: 2, recommendedMaxMembers: 3, iconKey: "basket", defaultPriority: 13,
  },
  {
    id: "banker",
    name: "은행원",
    shortDescription: "학급화폐 입출금을 접수하고 금액과 기록을 확인해요.",
    detailedTasks: "친구들의 실물 학급화폐 입출금을 접수하고 금액과 기록을 확인해요.",
    category: "economy", recommendedMinMembers: 2, recommendedMaxMembers: 3, iconKey: "bank", defaultPriority: 14,
  },
  {
    id: "classroom-guard",
    name: "교실 경비원",
    shortDescription: "쉬는 시간 교실과 소등·문단속 상태를 차분히 확인해요.",
    detailedTasks: "쉬는 시간 교실을 살피고 남아서 할 일이 있는 친구를 안내하며 소등과 문단속을 확인해요.",
    category: "life", recommendedMinMembers: 1, recommendedMaxMembers: 3, iconKey: "shield", defaultPriority: 10,
  },
  {
    id: "routine-checker",
    name: "알림장·양치 확인원",
    shortDescription: "알림장과 양치처럼 정한 생활습관을 확인하고 기록해요.",
    detailedTasks: "친구를 벌주는 역할이 아니라 정해진 생활습관을 확인·안내·기록하며 최종 판단은 교사가 해요.",
    category: "life", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "check", defaultPriority: 16,
  },
  {
    id: "meal-checker",
    name: "급식 확인원",
    shortDescription: "학급의 급식 약속을 확인하고 차분히 안내해요.",
    detailedTasks: "학급에서 정한 급식 약속을 확인하고 필요한 친구에게 차분히 안내하며 결과를 공개하지 않아요.",
    category: "life", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "meal", defaultPriority: 17,
  },
  {
    id: "board-schedule-manager",
    name: "칠판·시간표 관리원",
    shortDescription: "칠판과 날짜·시간표, 보드마카 상태를 정리해요.",
    detailedTasks: "칠판을 정리하고 날짜·시간표를 바꾸며 보드마카 상태를 확인해요.",
    category: "learning", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "board", defaultPriority: 3,
  },
  {
    id: "handout-collector",
    name: "배부·수합원",
    shortDescription: "학습지를 나누고 과제와 신청서를 빠짐없이 모아요.",
    detailedTasks: "학습지와 가정통신문을 나누어 주고 과제·신청서를 빠짐없이 모아요.",
    category: "learning", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "paper", defaultPriority: 2,
  },
  {
    id: "device-manager",
    name: "디지털기기 관리원",
    shortDescription: "태블릿과 충전기 수량, 케이블 상태를 확인해요.",
    detailedTasks: "태블릿과 충전기 수량을 확인하고 케이블과 전자기기를 정리해요.",
    category: "facilities", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "tablet", defaultPriority: 8,
  },
  {
    id: "energy-manager",
    name: "환기·에너지 관리원",
    shortDescription: "창문과 전등, 냉난방 상태를 확인해요.",
    detailedTasks: "정해진 시간에 창문을 열고 닫으며 전등과 냉난방 상태를 확인해요.",
    category: "life", recommendedMinMembers: 1, recommendedMaxMembers: 1, iconKey: "leaf", defaultPriority: 5,
  },
  {
    id: "recycling-manager",
    name: "분리수거원",
    shortDescription: "재활용품을 올바르게 나누고 지정 장소에 정리해요.",
    detailedTasks: "종이·플라스틱 등 재활용품을 올바르게 나누고 지정 장소에 정리해요.",
    category: "cleaning", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "recycle", defaultPriority: 4,
  },
  {
    id: "supply-manager",
    name: "청소도구·비품 관리원",
    shortDescription: "청소도구함과 학급 비품의 부족 여부를 확인해요.",
    detailedTasks: "청소도구함을 정리하고 휴지·보드마카 같은 물품이 부족하면 알려요.",
    category: "facilities", recommendedMinMembers: 1, recommendedMaxMembers: 1, iconKey: "box", defaultPriority: 6,
  },
  {
    id: "class-librarian",
    name: "학급 사서",
    shortDescription: "책 대출·반납을 돕고 책장과 도서 상태를 정리해요.",
    detailedTasks: "학급 책의 대출과 반납을 돕고 책장과 도서 상태를 정리해요.",
    category: "learning", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "book", defaultPriority: 9,
  },
  {
    id: "display-curator",
    name: "게시판·작품전시원",
    shortDescription: "작품과 안내물을 보기 좋게 붙이고 정리해요.",
    detailedTasks: "학생 작품과 안내물을 보기 좋게 붙이고 오래된 게시물을 정리해요.",
    category: "records", recommendedMinMembers: 1, recommendedMaxMembers: 1, iconKey: "picture", defaultPriority: 12,
  },
  {
    id: "sports-equipment-manager",
    name: "체육용품 관리원",
    shortDescription: "체육용품의 대여·회수와 수량을 확인해요.",
    detailedTasks: "공·라켓·줄넘기 같은 체육용품의 대여·회수와 수량을 확인해요.",
    category: "facilities", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "ball", defaultPriority: 15,
  },
  {
    id: "lost-and-found-manager",
    name: "분실물·대여소장",
    shortDescription: "분실물 보관과 공용 물품 대여를 기록해요.",
    detailedTasks: "분실물을 보관해 주인을 찾아 주고 학급 공용 물품의 대여를 기록해요.",
    category: "facilities", recommendedMinMembers: 1, recommendedMaxMembers: 1, iconKey: "tag", defaultPriority: 18,
  },
  {
    id: "absent-friend-helper",
    name: "결석친구 지원원",
    shortDescription: "결석하거나 조퇴한 친구의 자료와 안내를 챙겨요.",
    detailedTasks: "결석하거나 조퇴한 친구의 학습지와 안내사항을 챙겨 두어요.",
    category: "learning", recommendedMinMembers: 1, recommendedMaxMembers: 1, iconKey: "heart", defaultPriority: 7,
  },
  {
    id: "event-planner",
    name: "학급 행사기획원",
    shortDescription: "생일과 기념일, 작은 학급행사 준비를 도와요.",
    detailedTasks: "생일과 기념일을 확인하고 작은 축하나 학급행사 준비를 도와요.",
    category: "records", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "party", defaultPriority: 19,
  },
  {
    id: "class-reporter",
    name: "학급 기록기자",
    shortDescription: "학급 활동을 사진이나 짧은 글로 기록해요.",
    detailedTasks: "학교와 학급의 촬영·개인정보 규칙을 지키며 중요한 활동을 사진이나 짧은 글로 기록해요.",
    category: "records", recommendedMinMembers: 1, recommendedMaxMembers: 2, iconKey: "camera", defaultPriority: 20,
  },
];

const AREA_CATEGORIES: Record<string, JobCategory[]> = {
  cleaning: ["cleaning"],
  routine: ["life"],
  learning: ["learning", "facilities"],
  facilities: ["facilities"],
  life: ["life"],
  economy: ["economy"],
  records: ["records"],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedAnswers(input?: Partial<SurveyAnswers> | null): SurveyAnswers {
  return {
    areas: Array.isArray(input?.areas) ? input.areas.filter((value) => typeof value === "string") : [],
    economy: ["both", "mart", "bank", "none", "later"].includes(input?.economy ?? "") ? input!.economy! : "later",
    checks: Array.isArray(input?.checks) ? input.checks.filter((value) => typeof value === "string") : [],
    distribution: ["shared", "diverse", "balanced"].includes(input?.distribution ?? "") ? input!.distribution! : "balanced",
    includeJobIds: Array.isArray(input?.includeJobIds) ? input.includeJobIds.filter((value) => typeof value === "string") : [],
    excludeJobIds: Array.isArray(input?.excludeJobIds) ? input.excludeJobIds.filter((value) => typeof value === "string") : [],
  };
}

function targetJobCount(studentCount: number, preference: DistributionPreference) {
  if (preference === "shared") return clamp(Math.ceil(studentCount / 4), 1, Math.min(studentCount, 8));
  if (preference === "diverse") return clamp(Math.ceil(studentCount / 2), 1, Math.min(studentCount, 20));
  const lower = Math.min(studentCount, 8);
  const upper = Math.min(studentCount, 12);
  return clamp(Math.round(studentCount / 2.6), Math.max(1, lower), Math.max(1, upper));
}

function templateAllowed(template: JobTemplate, answers: SurveyAnswers, included: Set<string>) {
  if (answers.excludeJobIds.includes(template.id)) return false;
  if (included.has(template.id)) return true;
  if (template.id === "market-clerk" && !["both", "mart"].includes(answers.economy)) return false;
  if (template.id === "banker" && !["both", "bank"].includes(answers.economy)) return false;
  if (template.id === "routine-checker" && !answers.checks.includes("routine")) return false;
  if (template.id === "meal-checker" && !answers.checks.includes("meal")) return false;
  return true;
}

function templateScore(template: JobTemplate, answers: SurveyAnswers, included: Set<string>) {
  let score = 100 - template.defaultPriority;
  if (included.has(template.id)) score += 10_000;
  const selectedCategories = new Set(answers.areas.flatMap((area) => AREA_CATEGORIES[area] ?? []));
  if (selectedCategories.has(template.category)) score += 250;
  if (answers.economy === "both" && template.category === "economy") score += 180;
  if (answers.checks.includes("routine") && template.id === "routine-checker") score += 180;
  if (answers.checks.includes("meal") && template.id === "meal-checker") score += 180;
  return score;
}

function expansionRank(job: ClassJobDraft) {
  if (job.templateId === "classroom-cleaner") return 0;
  if (job.templateId === "handout-collector") return 1;
  if (job.category === "cleaning") return 2;
  if (job.category === "economy") return 3;
  if (job.category === "facilities") return 4;
  return 5;
}

function totalCapacity(jobs: ClassJobDraft[]) {
  return jobs.reduce((sum, job) => sum + job.memberCapacity, 0);
}

export function recommendJobs(studentCount: number, rawAnswers?: Partial<SurveyAnswers> | null): JobPlanResult {
  if (studentCount < 1) return { jobs: [], reasons: ["먼저 학생 명단을 등록해 주세요."] };
  const answers = normalizedAnswers(rawAnswers);
  const included = new Set(answers.includeJobIds);
  const candidates = JOB_TEMPLATES
    .filter((template) => templateAllowed(template, answers, included))
    .sort((left, right) => templateScore(right, answers, included) - templateScore(left, answers, included) || left.id.localeCompare(right.id));
  const desiredCount = Math.max(included.size, targetJobCount(studentCount, answers.distribution));
  const selected = candidates.slice(0, Math.min(desiredCount, studentCount));
  const jobs: ClassJobDraft[] = selected.map((template, index) => ({
    id: `template:${template.id}`,
    templateId: template.id,
    name: template.name,
    description: template.shortDescription,
    memberCapacity: 1,
    category: template.category,
    source: "recommended",
    sortOrder: index,
  }));

  const expandable = [...jobs].sort((left, right) => expansionRank(left) - expansionRank(right) || left.sortOrder - right.sortOrder);
  let remaining = studentCount - jobs.length;
  while (remaining > 0) {
    let changed = false;
    for (const job of expandable) {
      const template = JOB_TEMPLATES.find((item) => item.id === job.templateId);
      if (!template || job.memberCapacity >= template.recommendedMaxMembers) continue;
      job.memberCapacity += 1;
      remaining -= 1;
      changed = true;
      if (!remaining) break;
    }
    if (!changed) break;
  }
  while (remaining > 0 && expandable.length) {
    for (const job of expandable) {
      job.memberCapacity += 1;
      remaining -= 1;
      if (!remaining) break;
    }
  }

  const preferenceReason = answers.distribution === "shared"
    ? "직업 수를 줄이고 여러 학생이 함께 맡도록 구성했어요."
    : answers.distribution === "diverse"
      ? "다양한 일을 한두 명씩 맡을 수 있도록 직업 수를 늘렸어요."
      : "직업의 다양성과 함께 일하는 경험이 균형을 이루도록 구성했어요.";
  const reasons = [
    `등록 학생 ${studentCount}명에 맞춰 ${jobs.length}개 직업, ${totalCapacity(jobs)}자리를 준비했어요.`,
    preferenceReason,
  ];
  if (answers.economy === "none" || answers.economy === "later") reasons.push("학급경제 직업은 자동 추천에서 제외했어요.");
  if (answers.includeJobIds.length) reasons.push(`꼭 넣고 싶은 직업 ${answers.includeJobIds.length}개를 우선 반영했어요.`);
  return { jobs, reasons };
}

export function adjustJobsToStudentCount(studentCount: number, sourceJobs: ClassJobDraft[]): JobPlanResult {
  const jobs = sourceJobs.map((job, index) => ({ ...job, memberCapacity: Math.max(1, Math.floor(job.memberCapacity)), sortOrder: index }));
  const before = totalCapacity(jobs);
  const reasons: string[] = [];
  if (studentCount < 1) return { jobs, reasons: ["학생 명단이 비어 있어 자리를 조정하지 않았어요."] };
  if (!jobs.length) {
    const fallback = recommendJobs(studentCount, DEFAULT_SURVEY_ANSWERS);
    return { jobs: fallback.jobs, reasons: ["선택한 직업이 없어 균형형 추천으로 새 구성을 준비했어요.", ...fallback.reasons] };
  }

  if (before < studentCount) {
    let remaining = studentCount - before;
    const expandable = [...jobs].sort((left, right) => expansionRank(left) - expansionRank(right) || left.sortOrder - right.sortOrder);
    while (remaining > 0) {
      let changed = false;
      for (const job of expandable) {
        const template = JOB_TEMPLATES.find((item) => item.id === job.templateId);
        const preferredMax = template?.recommendedMaxMembers ?? Math.max(2, job.memberCapacity);
        if (job.memberCapacity >= preferredMax) continue;
        job.memberCapacity += 1;
        remaining -= 1;
        changed = true;
        if (!remaining) break;
      }
      if (!changed) break;
    }
    while (remaining > 0) {
      for (const job of expandable) {
        job.memberCapacity += 1;
        remaining -= 1;
        if (!remaining) break;
      }
    }
    reasons.push(`${studentCount - before}자리 부족분을 환경미화와 협업형 직업부터 늘렸어요.`);
  } else if (before > studentCount) {
    let excess = before - studentCount;
    const reducible = [...jobs].sort((left, right) => right.sortOrder - left.sortOrder || expansionRank(right) - expansionRank(left));
    while (excess > 0) {
      let changed = false;
      for (const job of reducible) {
        if (job.memberCapacity <= 1) continue;
        job.memberCapacity -= 1;
        excess -= 1;
        changed = true;
        if (!excess) break;
      }
      if (!changed) break;
    }
    while (excess > 0 && jobs.length > 1) {
      const removable = [...jobs].sort((left, right) => right.sortOrder - left.sortOrder).find((job) => job.memberCapacity <= excess);
      if (!removable) break;
      excess -= removable.memberCapacity;
      jobs.splice(jobs.findIndex((job) => job.id === removable.id), 1);
    }
    reasons.push(`${before - studentCount}자리 초과분을 정원이 넉넉한 직업부터 줄였어요.`);
  } else {
    reasons.push("이미 학생 수와 자리 수가 정확히 맞아요.");
  }
  return {
    jobs: jobs.map((job, index) => ({ ...job, sortOrder: index })),
    reasons: [...reasons, `조정 후 ${jobs.length}개 직업, ${totalCapacity(jobs)}자리예요.`],
  };
}

export function normalizeSurveyAnswers(input?: Partial<SurveyAnswers> | null) {
  return normalizedAnswers(input);
}

export function sumJobCapacity(jobs: ClassJobDraft[]) {
  return totalCapacity(jobs);
}

export type JobGrade = "A" | "B" | "C";

export type JobEvaluationScore = {
  hard: number;
  responsibility: number;
  consistency: number;
  burden: number;
};

export type JobEvaluationJob = {
  classJobId: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type JobEvaluationResult = JobEvaluationJob & {
  hardAverage: number;
  responsibilityAverage: number;
  consistencyAverage: number;
  burdenAverage: number;
  totalAverage: number;
  responseCount: number;
  rank: number;
  recommendedGrade: JobGrade;
  cutoffTie: boolean;
};

export const JOB_EVALUATION_CRITERIA = [
  {
    key: "hard",
    label: "힘듦",
    question: "몸이나 시간을 얼마나 써야 하나요?",
  },
  {
    key: "responsibility",
    label: "책임감",
    question: "실수하면 학급에 미치는 영향이 큰가요?",
  },
  {
    key: "consistency",
    label: "꾸준함",
    question: "매일 또는 자주 해야 하나요?",
  },
  {
    key: "burden",
    label: "개인 부담",
    question: "담당 인원에 비해 한 사람의 부담이 큰가요?",
  },
] as const;

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function suggestedGrade(index: number): JobGrade {
  if (index < 3) return "A";
  if (index < 8) return "B";
  return "C";
}

function equalScore(left: number, right: number) {
  return Math.abs(left - right) < Number.EPSILON * 32;
}

export function calculateJobEvaluationResults(
  jobs: readonly JobEvaluationJob[],
  responses: readonly Readonly<Record<string, JobEvaluationScore>>[],
): JobEvaluationResult[] {
  if (!responses.length) return [];

  const ranked = jobs.map((job) => {
    const jobScores = responses.map((response) => response[job.classJobId]);
    const hardAverage = average(jobScores.map((score) => score.hard));
    const responsibilityAverage = average(jobScores.map((score) => score.responsibility));
    const consistencyAverage = average(jobScores.map((score) => score.consistency));
    const burdenAverage = average(jobScores.map((score) => score.burden));
    return {
      ...job,
      hardAverage,
      responsibilityAverage,
      consistencyAverage,
      burdenAverage,
      totalAverage: hardAverage + responsibilityAverage + consistencyAverage + burdenAverage,
      responseCount: responses.length,
    };
  }).sort((left, right) => (
    right.totalAverage - left.totalAverage
    || left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, "ko")
    || left.classJobId.localeCompare(right.classJobId)
  ));

  const cutoffScores = [3, 8].flatMap((cutoff) => (
    ranked.length > cutoff && equalScore(
      ranked[cutoff - 1].totalAverage,
      ranked[cutoff].totalAverage,
    )
      ? [ranked[cutoff].totalAverage]
      : []
  ));

  return ranked.map((job, index) => ({
    ...job,
    rank: index + 1,
    recommendedGrade: suggestedGrade(index),
    cutoffTie: cutoffScores.some((score) => equalScore(score, job.totalAverage)),
  }));
}

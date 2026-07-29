import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const classId = process.env.TEST_CLASS_ID;

assert.ok(
  teacherEmail && teacherPassword && classId,
  [
    "월별 직업 선정 통합 테스트에 필요한 환경 변수가 없습니다.",
    "확정된 첫 직업 배정이 있는 테스트 학급을 준비한 뒤",
    "TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD, TEST_CLASS_ID를 설정해 주세요.",
    "필요하면 TEST_BASE_URL도 설정할 수 있습니다.",
  ].join(" "),
);

let cookie = "";

async function request(path, {
  method = "GET",
  body,
  expected = 200,
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  const accepted = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    accepted.includes(response.status),
    `${method} ${path}: HTTP ${response.status}, expected ${accepted.join(" or ")}: ${JSON.stringify(data)}`,
  );
  const nextCookie = response.headers.get("set-cookie")?.split(";")[0];
  if (nextCookie) cookie = nextCookie;
  return data;
}

async function loadBoard() {
  const payload = await request(basePath);
  return payload.board ?? payload;
}

await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: teacherPassword },
});
assert.match(cookie, /^job_classroom_session=/, "교사 로그인 세션 쿠키가 필요합니다.");

const basePath = `/api/classes/${classId}/monthly-job-choice`;
const initialBoard = await loadBoard();
assert.ok(initialBoard.sourcePeriod?.id, "마감할 지난달 확정 배정 sourcePeriod가 필요합니다.");
assert.ok(
  Array.isArray(initialBoard.gradePreview) && initialBoard.gradePreview.length > 0,
  "지난달 직업별 추천 등급 gradePreview가 필요합니다.",
);
assert.equal(
  initialBoard.evaluation?.status,
  "finalized",
  "학생 직업평가 마감과 최종등급 확정을 먼저 완료해 주세요.",
);

await request(`${basePath}/close`, {
  method: "POST",
  expected: [200, 201],
  body: {
    expectedSourcePeriodId: initialBoard.sourcePeriod.id,
  },
});

await request(`${basePath}/start`, {
  method: "POST",
  expected: [200, 201],
  body: {},
});

let board = await loadBoard();
assert.ok(board.session, "다음 달 직업 선택 session이 만들어져야 합니다.");
assert.equal(board.session.status, "draft");
assert.equal(board.session.orderMode, "shuffled", "동급 순서는 처음부터 자동 무작위여야 합니다.");
assert.ok(Number.isInteger(board.session.revision));
assert.ok(Number.isInteger(board.session.jobSetupRevision));
assert.ok(Array.isArray(board.session.order) && board.session.order.length > 0);
assert.equal(
  new Set(board.session.order.map((student) => student.studentId)).size,
  board.session.order.length,
  "선택 순서에 같은 학생이 중복되면 안 됩니다.",
);

await request(`${basePath}/shuffle`, {
  method: "POST",
  expected: 409,
  body: { expectedRevision: board.session.revision + 1 },
});

assert.ok(Array.isArray(board.jobs) && board.jobs.length > 0, "선택 가능한 직업 목록이 필요합니다.");
const totalCapacity = board.jobs.reduce((sum, job) => {
  assert.equal(typeof job.id, "string");
  assert.ok(Number.isInteger(job.capacity) && job.capacity > 0);
  return sum + job.capacity;
}, 0);
assert.equal(totalCapacity, board.session.order.length, "직업 정원 합은 선택 학생 수와 같아야 합니다.");

let studentIndex = 0;
const assignments = board.jobs.flatMap((job) => (
  Array.from({ length: job.capacity }, () => {
    const student = board.session.order[studentIndex++];
    assert.ok(student, `${job.id} 직업 정원에 배정할 학생이 부족합니다.`);
    return { studentId: student.studentId, classJobId: job.id };
  })
));
assert.equal(assignments.length, board.session.order.length);
assert.equal(new Set(assignments.map((assignment) => assignment.studentId)).size, assignments.length);

const staleCompleteBody = {
  expectedRevision: board.session.revision + 1,
  expectedJobSetupRevision: board.session.jobSetupRevision,
  requestId: crypto.randomUUID(),
  assignments,
};
await request(`${basePath}/complete`, {
  method: "POST",
  expected: 409,
  body: staleCompleteBody,
});

const completeBody = {
  ...staleCompleteBody,
  expectedRevision: board.session.revision,
  requestId: crypto.randomUUID(),
};
await request(`${basePath}/complete`, {
  method: "POST",
  expected: [200, 201],
  body: completeBody,
});

await request(`${basePath}/complete`, {
  method: "POST",
  expected: 409,
  body: { ...completeBody, requestId: crypto.randomUUID() },
});

board = await loadBoard();
assert.equal(board.session?.status, "confirmed");
assert.ok(Array.isArray(board.confirmedAssignments));
assert.equal(board.confirmedAssignments.length, assignments.length);
assert.equal(
  new Set(board.confirmedAssignments.map((assignment) => assignment.studentId)).size,
  board.confirmedAssignments.length,
  "확정 배정에는 같은 학생이 두 번 들어가면 안 됩니다.",
);
assert.deepEqual(
  new Set(board.confirmedAssignments.map((assignment) => assignment.studentId)),
  new Set(board.session.order.map((student) => student.studentId)),
  "선택 순서의 모든 학생이 정확히 한 번 확정되어야 합니다.",
);

console.log("월별 직업 선정 통합 검증 완료: 마감·순서 시작·stale 충돌·정원 배정·원자 확정·중복 방지");

import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const inviteCode = process.env.TEST_INVITE_CODE;
assert.ok(inviteCode, "TEST_INVITE_CODE가 필요합니다.");

const runNumber = Date.now();
const teacherEmail = `assignment-${runNumber}@example.test`;
const password = "Teacher!234";
let cookie = "";

async function request(path, { method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  const nextCookie = response.headers.get("set-cookie")?.split(";")[0];
  if (nextCookie) cookie = nextCookie;
  return data;
}

const signup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: teacherEmail, password },
  expected: 201,
});
assert.ok(signup.verification?.developmentUrl);
const emailToken = new URL(signup.verification.developmentUrl).searchParams.get("verifyEmailToken");
await request("/api/teacher/email-verification/confirm", {
  method: "POST",
  body: { token: emailToken },
});
await request("/api/teacher/invite-code/redeem", {
  method: "POST",
  body: { code: inviteCode },
});

const schoolSearch = await request(`/api/schools/search?q=${encodeURIComponent("서이초")}`);
assert.equal(schoolSearch.schools.length, 1);
assert.equal(schoolSearch.schools[0].official_name, "서울서이초등학교");
await request("/api/schools/select", {
  method: "POST",
  body: { schoolId: schoolSearch.schools[0].id },
});

const year = 2050 + (runNumber % 40);
const grade = 1 + (runNumber % 6);
const classNumber = 1 + (runNumber % 30);
const classCreated = await request("/api/classes", {
  method: "POST",
  body: { schoolYear: year, grade, classNumber, displayName: "첫 배정 검증반" },
  expected: 201,
});
const classId = classCreated.class.id;
const roster = await request(`/api/classes/${classId}/students`, {
  method: "POST",
  body: {
    students: [
      { number: 1, name: "가학생" },
      { number: 2, name: "나학생" },
      { number: 3, name: "다학생" },
    ],
  },
  expected: 201,
});

const setup = await request(`/api/classes/${classId}/job-setup`);
const jobs = setup.templates.slice(0, 3).map((template, index) => ({
  id: `${classId}:${template.id}`,
  templateId: template.id,
  name: template.name,
  description: template.shortDescription,
  memberCapacity: 1,
  category: template.category,
  source: "template",
  sortOrder: index,
}));
await request(`/api/classes/${classId}/job-setup/complete`, {
  method: "POST",
  body: {
    expectedRevision: 0,
    setupMode: "manual",
    surveyAnswers: {},
    jobs,
  },
});

const board = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(board.period.serverTime.timeZone, "Asia/Seoul");
assert.equal(board.period.monthValue, board.period.serverTime.monthValue);
assert.equal(board.availableStudents.length, 3);
assert.equal(board.setupReady, true);

const randomResult = await request(`/api/classes/${classId}/job-assignments/random`, {
  method: "POST",
  body: {
    year: board.period.year,
    month: board.period.month,
    classJobId: board.jobs[0].id,
    candidateStudentIds: roster.students.slice(0, 2).map((student) => student.id),
  },
  expected: 201,
});
assert.ok(roster.students.slice(0, 2).some(
  (student) => student.id === randomResult.assignment.student.id,
));

const afterRandom = await request(
  `/api/classes/${classId}/job-assignments?year=${board.period.year}&month=${board.period.month}`,
);
assert.equal(afterRandom.availableStudents.length, 2);
const manualStudent = afterRandom.availableStudents[0];
await request(`/api/classes/${classId}/job-assignments/manual`, {
  method: "POST",
  body: {
    year: board.period.year,
    month: board.period.month,
    classJobId: afterRandom.jobs[1].id,
    studentId: manualStudent.id,
  },
  expected: 201,
});
await request(`/api/classes/${classId}/job-assignments/manual`, {
  method: "POST",
  body: {
    year: board.period.year,
    month: board.period.month,
    classJobId: afterRandom.jobs[2].id,
    studentId: manualStudent.id,
  },
  expected: 409,
});
await request(
  `/api/classes/${classId}/job-assignments/${randomResult.assignment.assignmentId}`,
  { method: "DELETE" },
);
const afterRemoval = await request(
  `/api/classes/${classId}/job-assignments?year=${board.period.year}&month=${board.period.month}`,
);
assert.equal(afterRemoval.availableStudents.length, 2);
assert.ok(afterRemoval.availableStudents.some(
  (student) => student.id === randomResult.assignment.student.id,
));

console.log("첫 배정 통합 검증 완료: 학교 검색·서울 표준시·랜덤·직접 선택·중복 차단·취소");

import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const inviteCode = process.env.TEST_INVITE_CODE;
assert.ok(inviteCode, "TEST_INVITE_CODE가 필요합니다.");

const runNumber = Date.now();
const teacherEmail = `assignment-${runNumber}@example.test`;
const password = "Teacher!234";
let cookie = "";

function bearerTokenFromFragment(url, name) {
  const parsed = new URL(url);
  assert.equal(parsed.search, "", `${name} bearer token은 query string에 두지 않는다`);
  const token = new URLSearchParams(parsed.hash.replace(/^#/, "")).get(name);
  assert.ok(token, `${name} bearer token이 fragment에 있어야 한다`);
  return token;
}

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

await request("/api/teacher/signup", {
  method: "POST",
  body: { email: teacherEmail, password },
  expected: 202,
});
assert.equal(cookie, "");
await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password },
});
const verification = await request("/api/teacher/email-verification/request", {
  method: "POST",
  body: {},
});
assert.ok(verification.verification?.developmentUrl);
const emailToken = bearerTokenFromFragment(verification.verification.developmentUrl, "verifyEmailToken");
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
  memberCapacity: index === 0 ? 2 : 1,
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

let board = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(board.calendar.serverTime.timeZone, "Asia/Seoul");
assert.equal(board.calendar.saved, false);
assert.equal(board.availableStudents.length, 3);
assert.equal(board.setupReady, true);
assert.ok(board.preflight.errors.some((item) => item.code === "CALENDAR_REQUIRED"));

const initialCalendar = await request(`/api/classes/${classId}/calendar`);
assert.equal(initialCalendar.calendar.serverTime.timeZone, "Asia/Seoul");
assert.equal(initialCalendar.calendar.days.length >= 28, true);
assert.ok(initialCalendar.calendar.days.some((day) => day.isWeekend && day.dayType === "off"));
const calendarSaved = await request(`/api/classes/${classId}/calendar`, {
  method: "PUT",
  body: {
    expectedRevision: 0,
    schoolYear: year,
    classStartDate: initialCalendar.calendar.classStartDate,
    firstJobStartDate: initialCalendar.calendar.firstJobStartDate,
    firstJobEndDate: initialCalendar.calendar.firstJobEndDate,
    days: initialCalendar.calendar.days.map(({ date, dayType, memo }) => ({ date, dayType, memo })),
  },
});
assert.equal(calendarSaved.calendar.saved, true);
assert.equal(calendarSaved.calendar.revision, 1);

board = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(board.preflight.ready, true);
assert.equal(board.mode, null);
await request(`/api/classes/${classId}/job-assignments/mode`, {
  method: "PUT",
  body: { mode: "random" },
});
await request(`/api/classes/${classId}/job-assignments/candidates`, {
  method: "PUT",
  body: {
    classJobId: board.jobs[0].id,
    studentIds: roster.students.slice(0, 2).map((student) => student.id),
  },
});
const withCandidates = await request(`/api/classes/${classId}/job-assignments`);
assert.deepEqual(
  withCandidates.candidateStudentIdsByJob[board.jobs[0].id],
  roster.students.slice(0, 2).map((student) => student.id),
);

const randomRequestId = crypto.randomUUID();
const randomResult = await request(`/api/classes/${classId}/job-assignments/random`, {
  method: "POST",
  body: {
    classJobId: board.jobs[0].id,
    candidateStudentIds: roster.students.slice(0, 2).map((student) => student.id),
    requestId: randomRequestId,
  },
  expected: 201,
});
assert.ok(roster.students.slice(0, 2).some(
  (student) => student.id === randomResult.assignment.student.id,
));
const repeatedRandom = await request(`/api/classes/${classId}/job-assignments/random`, {
  method: "POST",
  body: {
    classJobId: board.jobs[0].id,
    candidateStudentIds: roster.students.slice(0, 2).map((student) => student.id),
    requestId: randomRequestId,
  },
});
assert.equal(repeatedRandom.assignment.student.id, randomResult.assignment.student.id);

const afterRandom = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(afterRandom.availableStudents.length, 2);
assert.ok(!Object.values(afterRandom.candidateStudentIdsByJob).flat().includes(randomResult.assignment.student.id));
await request(`/api/classes/${classId}/job-assignments/mode`, {
  method: "PUT",
  body: { mode: "manual" },
});
const modeChanged = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(modeChanged.mode, "manual");
assert.equal(modeChanged.assignments.length, 1);

await request(`/api/classes/${classId}/job-assignments/manual`, {
  method: "POST",
  body: {
    classJobId: afterRandom.jobs[1].id,
    studentIds: afterRandom.availableStudents.map((student) => student.id),
    requestId: crypto.randomUUID(),
  },
  expected: 409,
});
const afterRejectedBatch = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(afterRejectedBatch.assignments.length, 1);

const manualStudent = afterRandom.availableStudents[0];
await request(`/api/classes/${classId}/job-assignments/manual`, {
  method: "POST",
  body: {
    classJobId: afterRandom.jobs[1].id,
    studentIds: [manualStudent.id],
    requestId: crypto.randomUUID(),
  },
  expected: 201,
});
const lastStudent = afterRandom.availableStudents.find((student) => student.id !== manualStudent.id);
await request(`/api/classes/${classId}/job-assignments/manual`, {
  method: "POST",
  body: {
    classJobId: afterRandom.jobs[2].id,
    studentIds: [lastStudent.id],
    requestId: crypto.randomUUID(),
  },
  expected: 201,
});
const readyToComplete = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(readyToComplete.summary.availableCount, 0);
assert.equal(readyToComplete.summary.remainingSeats, 1);
assert.equal(readyToComplete.summary.canComplete, true);
const partialAssignments = roster.students.slice(0, 2).map((student) => ({
  classJobId: readyToComplete.jobs[0].id,
  studentId: student.id,
  method: "manual",
}));

const teacherCookie = cookie;
const activationUrl = new URL(roster.students[0].activation_url);
const activationToken = new URLSearchParams(activationUrl.hash.replace(/^#/, "")).get("token");
await request("/api/registration/verify", {
  method: "POST",
  body: { token: activationToken },
});
await request("/api/registration/complete", {
  method: "POST",
  body: { password: "258025" },
});
const studentCookie = cookie;
const beforeConfirmation = await request("/api/student/me");
assert.equal(beforeConfirmation.student.current_job, null);

cookie = teacherCookie;
await request(`/api/classes/${classId}/job-assignments/complete`, {
  method: "POST",
  expected: 409,
  body: {
    mode: readyToComplete.mode,
    expectedRevision: readyToComplete.revision - 1,
    expectedCalendarRevision: readyToComplete.calendar.revision,
    requestId: crypto.randomUUID(),
    assignments: partialAssignments,
  },
});
const afterStaleRequest = await request(`/api/classes/${classId}/job-assignments`);
assert.deepEqual(
  afterStaleRequest.assignments.map((assignment) => assignment.id),
  readyToComplete.assignments.map((assignment) => assignment.id),
);
await request(`/api/classes/${classId}/job-assignments/complete`, {
  method: "POST",
  body: {
    mode: readyToComplete.mode,
    expectedRevision: readyToComplete.revision,
    expectedCalendarRevision: readyToComplete.calendar.revision,
    requestId: crypto.randomUUID(),
    assignments: partialAssignments,
  },
});
const confirmed = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(confirmed.status, "confirmed");
assert.equal(confirmed.assignments.length, 2);
assert.equal(confirmed.summary.availableCount, 1);
assert.equal(confirmed.summary.remainingSeats, 2);
await request(`/api/classes/${classId}/job-assignments/complete`, {
  method: "POST",
  expected: 409,
  body: {
    mode: readyToComplete.mode,
    expectedRevision: readyToComplete.revision,
    expectedCalendarRevision: readyToComplete.calendar.revision,
    requestId: crypto.randomUUID(),
    assignments: partialAssignments,
  },
});
const afterRepeatedConfirmation = await request(`/api/classes/${classId}/job-assignments`);
assert.equal(afterRepeatedConfirmation.assignments.length, 2);
await request(
  `/api/classes/${classId}/job-assignments/${confirmed.assignments[0].id}`,
  { method: "DELETE", expected: 409 },
);

cookie = studentCookie;
const afterConfirmation = await request("/api/student/me");
assert.ok(afterConfirmation.student.current_job);
assert.equal(typeof afterConfirmation.student.current_job.name, "string");

console.log("달력·첫 배정 통합 검증 완료: 서울 표준시·주말·후보 복원·멱등 추첨·수동 원자 저장·방식 변경·최종 확정·학생 공개");

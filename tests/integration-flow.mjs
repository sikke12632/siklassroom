import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const teacherEmail = `teacher-${runId}@example.test`;
const secondTeacherEmail = `other-${runId}@example.test`;
const schoolName = `검증초${runId.slice(-6)}`;
const firstPassword = "Teacher!234";
const nextPassword = "Teacher!567";
const adminUsername = process.env.SYSTEM_ADMIN_USERNAME;
const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD;
const adminPath = process.env.SYSTEM_ADMIN_PATH;
assert.ok(adminUsername && adminPassword && adminPath, "시스템 관리자 통합 테스트 환경 변수가 필요합니다.");

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  return value?.split(";")[0] || "";
}

function capacityOf(jobs) {
  return jobs.reduce((sum, job) => sum + job.memberCapacity, 0);
}

async function request(path, { cookie = "", method = "GET", body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return { response, data };
}

await request("/api/classes", { expected: 401 });
await request("/ops/not-the-admin-path", { expected: 404 });
await request(`/ops/${adminPath}`);
await request("/api/admin/dashboard", { expected: 401 });
for (let attempt = 0; attempt < 7; attempt += 1) {
  await request("/api/admin/auth/login", {
    method: "POST",
    body: { username: `blocked-${runId}`, password: "wrong-password" },
    expected: 401,
  });
}
await request("/api/admin/auth/login", {
  method: "POST",
  body: { username: `blocked-${runId}`, password: "wrong-password" },
  expected: 429,
});
const adminLogin = await request("/api/admin/auth/login", {
  method: "POST",
  body: { username: adminUsername, password: adminPassword },
});
const adminCookie = cookieFrom(adminLogin.response);
const adminCsrf = adminLogin.data.csrfToken;
assert.match(adminCookie, /^job_classroom_admin_session=/);
assert.ok(adminCsrf);

const signup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
  expected: 201,
});
let teacherCookie = cookieFrom(signup.response);
assert.match(teacherCookie, /^job_classroom_session=/);

await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2099, grade: 5, classNumber: 9 },
  expected: 403,
});
assert.ok(signup.data.verification.developmentUrl);
const emailToken = new URL(signup.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
await request("/api/teacher/email-verification/confirm", {
  method: "POST",
  body: { token: emailToken },
});
await request("/api/teacher/email-verification/confirm", {
  method: "POST",
  body: { token: emailToken },
  expected: 410,
});

const outsider = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: secondTeacherEmail, password: firstPassword },
  expected: 201,
});
let outsiderCookie = cookieFrom(outsider.response);
const outsiderEmailToken = new URL(outsider.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
await request("/api/teacher/email-verification/confirm", {
  method: "POST",
  body: { token: outsiderEmailToken },
});

await request("/api/admin/schools/import", {
  cookie: adminCookie,
  method: "POST",
  headers: { "x-admin-csrf": adminCsrf },
  body: {
    schools: [{
      officeCode: "TST",
      schoolCode: `S${runId.replace(/\W/g, "").slice(-12)}`,
      officialName: schoolName,
      schoolLevel: "초등학교",
      provinceName: "서울특별시",
      districtName: "검증교육지원청",
      roadAddress: "서울특별시 검증구 1",
    }],
  },
});
const search = await request(`/api/schools/search?q=${encodeURIComponent(schoolName)}`, {
  cookie: teacherCookie,
});
assert.equal(search.data.schools.length, 1);
const schoolId = search.data.schools[0].id;

const sharedInvite = await request("/api/admin/invite-codes", {
  cookie: adminCookie,
  method: "POST",
  headers: { "x-admin-csrf": adminCsrf },
  body: { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
  expected: 201,
});
const parallelRedeem = await Promise.all([
  fetch(`${baseUrl}/api/teacher/invite-code/redeem`, {
    method: "POST", headers: { cookie: teacherCookie, "content-type": "application/json" },
    body: JSON.stringify({ code: sharedInvite.data.code }),
  }),
  fetch(`${baseUrl}/api/teacher/invite-code/redeem`, {
    method: "POST", headers: { cookie: outsiderCookie, "content-type": "application/json" },
    body: JSON.stringify({ code: sharedInvite.data.code }),
  }),
]);
assert.deepEqual(parallelRedeem.map((response) => response.status).sort(), [200, 410]);
for (const [cookie, response] of [[teacherCookie, parallelRedeem[0]], [outsiderCookie, parallelRedeem[1]]]) {
  if (response.status === 200) continue;
  const replacement = await request("/api/admin/invite-codes", {
    cookie: adminCookie,
    method: "POST",
    headers: { "x-admin-csrf": adminCsrf },
    body: { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
    expected: 201,
  });
  await request("/api/teacher/invite-code/redeem", {
    cookie,
    method: "POST",
    body: { code: replacement.data.code },
  });
}
await request("/api/schools/select", { cookie: teacherCookie, method: "POST", body: { schoolId } });
await request("/api/schools/select", { cookie: outsiderCookie, method: "POST", body: { schoolId } });

const manualSignup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: `manual-${runId}@example.test`, password: firstPassword },
  expected: 201,
});
const manualCookie = cookieFrom(manualSignup.response);
const manualEmailToken = new URL(manualSignup.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
await request("/api/teacher/email-verification/confirm", { method: "POST", body: { token: manualEmailToken } });
const manualInvite = await request("/api/admin/invite-codes", {
  cookie: adminCookie,
  method: "POST",
  headers: { "x-admin-csrf": adminCsrf },
  body: { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
  expected: 201,
});
await request("/api/teacher/invite-code/redeem", {
  cookie: manualCookie,
  method: "POST",
  body: { code: manualInvite.data.code },
});
const manualSchool = await request("/api/schools/manual", {
  cookie: manualCookie,
  method: "POST",
  body: {
    enteredName: `직접입력학교${runId.slice(-4)}`,
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "검증구",
    note: "<script>alert(1)</script>",
  },
  expected: 400,
});
assert.equal(manualSchool.data.code, "INVALID_SCHOOL_DETAIL");
const manualRequest = await request("/api/schools/manual", {
  cookie: manualCookie,
  method: "POST",
  body: {
    enteredName: `직접입력학교${runId.slice(-4)}`,
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "검증구",
  },
  expected: 201,
});
await request("/api/admin/school-requests", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: manualRequest.data.request.id, action: "approve_new", note: "통합 테스트 신규 학교 승인" },
});
const manualSession = await request("/api/session", { cookie: manualCookie });
assert.ok(manualSession.data.actor.school_id);
assert.equal(manualSession.data.actor.manual_school_request_id, null);

const classCreated = await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2099, grade: 5, classNumber: 9, displayName: "검증반" },
  expected: 201,
});
const classId = classCreated.data.class.id;
await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2099, grade: 5, classNumber: 9 },
  expected: 409,
});

const roster = await request(`/api/classes/${classId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: { students: [{ number: 1, name: "김하늘" }, { number: 2, name: "김하늘" }] },
  expected: 201,
});
assert.equal(roster.data.students.length, 2);
const student = roster.data.students[0];
const activationToken = new URL(student.activation_url).searchParams.get("token");
assert.ok(activationToken);

await request(`/api/classes/${classId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: { students: [{ number: 2, name: "번호중복" }] },
  expected: 409,
});

const jobClassCreated = await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2099, grade: 5, classNumber: 8, displayName: "직업검증반" },
  expected: 201,
});
const jobClassId = jobClassCreated.data.class.id;
const jobRoster = await request(`/api/classes/${jobClassId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    students: Array.from({ length: 26 }, (_, index) => ({
      number: index + 1,
      name: `직업학생${index + 1}`,
    })),
  },
  expected: 201,
});
const initialSetup = await request(`/api/classes/${jobClassId}/job-setup`, { cookie: teacherCookie });
assert.equal(initialSetup.data.studentCount, 26);
assert.equal(initialSetup.data.templates.length, 20);
assert.equal(initialSetup.data.setup.revision, 0);

const surveyAnswers = {
  areas: ["cleaning", "learning"],
  economy: "none",
  checks: [],
  distribution: "balanced",
  includeJobIds: [],
  excludeJobIds: [],
};
const recommendation = await request(`/api/classes/${jobClassId}/job-setup/recommend`, {
  cookie: teacherCookie,
  method: "POST",
  body: { surveyAnswers },
});
assert.equal(capacityOf(recommendation.data.jobs), 26);
assert.ok(recommendation.data.jobs.length >= 8 && recommendation.data.jobs.length <= 12);
assert.ok(!recommendation.data.jobs.some((job) => ["banker", "market-clerk"].includes(job.templateId)));

const mismatchedDraft = structuredClone(recommendation.data.jobs);
mismatchedDraft[0].memberCapacity -= 1;
assert.equal(capacityOf(mismatchedDraft), 25);
const draftSaved = await request(`/api/classes/${jobClassId}/job-setup/draft`, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: 0,
    setupMode: "recommended",
    surveyAnswers,
    jobs: mismatchedDraft,
    lastStep: 3,
  },
});
assert.equal(draftSaved.data.setup.revision, 1);
assert.equal(draftSaved.data.setup.selectedCapacity, 25);
await request(`/api/classes/${jobClassId}/job-setup/draft`, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: 0,
    setupMode: "recommended",
    surveyAnswers,
    jobs: mismatchedDraft,
    lastStep: 3,
  },
  expected: 409,
});

const adjusted = await request(`/api/classes/${jobClassId}/job-setup/adjust`, {
  cookie: teacherCookie,
  method: "POST",
  body: { jobs: mismatchedDraft },
});
assert.equal(capacityOf(adjusted.data.jobs), 26);
const jobsToComplete = structuredClone(adjusted.data.jobs);
jobsToComplete[0].name = "우리 반 특별 환경지킴이";
jobsToComplete[jobsToComplete.length - 1] = {
  id: `${jobClassId}:custom:welcome-helper`,
  templateId: null,
  name: "새 친구 환영 도우미",
  description: "새로 온 친구가 교실에 적응하도록 안내해요.",
  memberCapacity: jobsToComplete[jobsToComplete.length - 1].memberCapacity,
  category: "life",
  source: "custom",
  sortOrder: jobsToComplete.length - 1,
};
const completed = await request(`/api/classes/${jobClassId}/job-setup/complete`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    expectedRevision: 1,
    setupMode: "recommended",
    surveyAnswers,
    jobs: jobsToComplete,
  },
});
assert.equal(completed.data.setup.status, "completed");
assert.equal(completed.data.setup.revision, 2);
assert.equal(capacityOf(completed.data.setup.draftJobs), 26);
await request(`/api/classes/${jobClassId}/job-setup/complete`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    expectedRevision: 1,
    setupMode: "recommended",
    surveyAnswers,
    jobs: jobsToComplete,
  },
  expected: 409,
});
const restored = await request(`/api/classes/${jobClassId}/job-setup`, { cookie: teacherCookie });
assert.equal(restored.data.setup.status, "completed");
assert.ok(restored.data.setup.draftJobs.some((job) => job.source === "custom"));
assert.ok(restored.data.templates.every((template) => template.name !== "우리 반 특별 환경지킴이"));

const initialAssignmentBoard = await request(
  `/api/classes/${jobClassId}/job-assignments`,
  { cookie: teacherCookie },
);
assert.equal(initialAssignmentBoard.data.period.serverTime.timeZone, "Asia/Seoul");
assert.equal(initialAssignmentBoard.data.period.monthValue, initialAssignmentBoard.data.period.serverTime.monthValue);
assert.equal(initialAssignmentBoard.data.setupReady, true);
assert.equal(initialAssignmentBoard.data.availableStudents.length, 26);
assert.equal(initialAssignmentBoard.data.calendar.saved, false);
const jobCalendar = await request(`/api/classes/${jobClassId}/calendar`, { cookie: teacherCookie });
await request(`/api/classes/${jobClassId}/calendar`, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: 0,
    schoolYear: jobCalendar.data.calendar.schoolYear,
    classStartDate: jobCalendar.data.calendar.classStartDate,
    firstJobStartDate: jobCalendar.data.calendar.firstJobStartDate,
    firstJobEndDate: jobCalendar.data.calendar.firstJobEndDate,
    days: jobCalendar.data.calendar.days.map(({ date, dayType, memo }) => ({ date, dayType, memo })),
  },
});
await request(`/api/classes/${jobClassId}/job-assignments/mode`, {
  cookie: teacherCookie,
  method: "PUT",
  body: { mode: "random" },
});
const firstAssignmentJob = initialAssignmentBoard.data.jobs.find((job) => job.remainingCapacity > 0);
assert.ok(firstAssignmentJob);
const randomAssignment = await request(`/api/classes/${jobClassId}/job-assignments/random`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    classJobId: firstAssignmentJob.id,
    candidateStudentIds: jobRoster.data.students.slice(0, 3).map((studentRow) => studentRow.id),
    requestId: crypto.randomUUID(),
  },
  expected: 201,
});
assert.ok(jobRoster.data.students.slice(0, 3).some(
  (studentRow) => studentRow.id === randomAssignment.data.assignment.student.id,
));
const afterRandom = await request(
  `/api/classes/${jobClassId}/job-assignments`,
  { cookie: teacherCookie },
);
assert.equal(afterRandom.data.availableStudents.length, 25);
assert.ok(!afterRandom.data.availableStudents.some(
  (studentRow) => studentRow.id === randomAssignment.data.assignment.student.id,
));
const manualStudent = afterRandom.data.availableStudents[0];
const manualJob = afterRandom.data.jobs.find((job) => job.remainingCapacity > 0);
const manualAssignment = await request(`/api/classes/${jobClassId}/job-assignments/manual`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    classJobId: manualJob.id,
    studentIds: [manualStudent.id],
    requestId: crypto.randomUUID(),
  },
  expected: 201,
});
assert.equal(manualAssignment.data.assignment.students[0].id, manualStudent.id);
await request(`/api/classes/${jobClassId}/job-assignments/manual`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    classJobId: manualJob.id,
    studentIds: [manualStudent.id],
    requestId: crypto.randomUUID(),
  },
  expected: 409,
});
await request(`/api/classes/${jobClassId}/job-assignments`, {
  cookie: outsiderCookie,
  expected: 404,
});
await request(
  `/api/classes/${jobClassId}/job-assignments/${randomAssignment.data.assignment.assignmentId}`,
  { cookie: teacherCookie, method: "DELETE" },
);
const afterRemoval = await request(
  `/api/classes/${jobClassId}/job-assignments`,
  { cookie: teacherCookie },
);
assert.equal(afterRemoval.data.availableStudents.length, 25);
assert.ok(afterRemoval.data.availableStudents.some(
  (studentRow) => studentRow.id === randomAssignment.data.assignment.student.id,
));

let assignmentStudentIndex = 0;
const submittedInitialAssignments = afterRemoval.data.jobs.flatMap((job) => (
  Array.from({ length: job.memberCapacity }, () => ({
    studentId: jobRoster.data.students[assignmentStudentIndex++].id,
    classJobId: job.id,
    method: "manual",
  }))
));
assert.equal(submittedInitialAssignments.length, jobRoster.data.students.length);
await request(`/api/classes/${jobClassId}/job-assignments/complete`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    mode: "manual",
    expectedRevision: afterRemoval.data.revision,
    expectedCalendarRevision: afterRemoval.data.calendar.revision,
    requestId: crypto.randomUUID(),
    assignments: submittedInitialAssignments,
  },
});

const evaluationStudent = jobRoster.data.students[0];
const evaluationActivationToken = new URL(evaluationStudent.activation_url).searchParams.get("token");
assert.ok(evaluationActivationToken);
const evaluationActivation = await request("/api/registration/complete", {
  method: "POST",
  body: { token: evaluationActivationToken, password: "3579" },
});
const evaluationStudentCookie = cookieFrom(evaluationActivation.response);
const monthlyBasePath = `/api/classes/${jobClassId}/monthly-job-choice`;
const monthlyBeforeEvaluation = await request(monthlyBasePath, { cookie: teacherCookie });
assert.ok(monthlyBeforeEvaluation.data.sourcePeriod?.id);
assert.equal(monthlyBeforeEvaluation.data.evaluation, null);
await request(`/api/classes/${jobClassId}/job-evaluation/open`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    expectedSourcePeriodId: monthlyBeforeEvaluation.data.sourcePeriod.id,
    expectedSourcePeriodRevision: monthlyBeforeEvaluation.data.sourcePeriod.revision,
  },
  expected: 201,
});
const studentEvaluation = await request("/api/student/job-evaluation", {
  cookie: evaluationStudentCookie,
});
assert.equal(studentEvaluation.data.evaluation.status, "open");
assert.ok(studentEvaluation.data.evaluation.jobs.length > 0);
await request("/api/student/job-evaluation", {
  cookie: evaluationStudentCookie,
  method: "POST",
  body: {
    evaluationId: studentEvaluation.data.evaluation.id,
    expectedSessionRevision: studentEvaluation.data.evaluation.revision,
    expectedResponseRevision: 0,
    requestId: crypto.randomUUID(),
    scores: studentEvaluation.data.evaluation.jobs.slice(1).map((job) => ({
      classJobId: job.classJobId,
      hard: 3,
      responsibility: 3,
      consistency: 3,
      burden: 3,
    })),
  },
  expected: 400,
});
const evaluationRequestId = crypto.randomUUID();
const evaluationScores = studentEvaluation.data.evaluation.jobs.map((job, index) => ({
  classJobId: job.classJobId,
  hard: 1 + (index % 5),
  responsibility: 1 + ((index + 1) % 5),
  consistency: 1 + ((index + 2) % 5),
  burden: 1 + ((index + 3) % 5),
}));
const submittedEvaluation = await request("/api/student/job-evaluation", {
  cookie: evaluationStudentCookie,
  method: "POST",
  body: {
    evaluationId: studentEvaluation.data.evaluation.id,
    expectedSessionRevision: studentEvaluation.data.evaluation.revision,
    expectedResponseRevision: 0,
    requestId: evaluationRequestId,
    scores: evaluationScores,
  },
});
assert.equal(submittedEvaluation.data.evaluation.submission.revision, 1);
await request("/api/student/job-evaluation", {
  cookie: evaluationStudentCookie,
  method: "POST",
  body: {
    evaluationId: studentEvaluation.data.evaluation.id,
    expectedSessionRevision: studentEvaluation.data.evaluation.revision,
    expectedResponseRevision: 0,
    requestId: evaluationRequestId,
    scores: evaluationScores,
  },
});
let teacherEvaluation = await request(`/api/classes/${jobClassId}/job-evaluation`, {
  cookie: teacherCookie,
});
assert.equal(teacherEvaluation.data.evaluation.submittedCount, 1);
await request(`/api/classes/${jobClassId}/job-evaluation/close`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    evaluationId: teacherEvaluation.data.evaluation.id,
    expectedRevision: teacherEvaluation.data.evaluation.revision,
    expectedResponseRevision: teacherEvaluation.data.evaluation.responseRevision,
    allowIncomplete: false,
  },
  expected: 409,
});
await request(`/api/classes/${jobClassId}/job-evaluation/close`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    evaluationId: teacherEvaluation.data.evaluation.id,
    expectedRevision: teacherEvaluation.data.evaluation.revision,
    expectedResponseRevision: teacherEvaluation.data.evaluation.responseRevision,
    allowIncomplete: true,
  },
});
teacherEvaluation = await request(`/api/classes/${jobClassId}/job-evaluation`, {
  cookie: teacherCookie,
});
assert.equal(teacherEvaluation.data.evaluation.status, "closed");
assert.equal(teacherEvaluation.data.evaluation.jobs.length, studentEvaluation.data.evaluation.jobs.length);
await request(`/api/classes/${jobClassId}/job-evaluation/finalize`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    evaluationId: teacherEvaluation.data.evaluation.id,
    expectedRevision: teacherEvaluation.data.evaluation.revision,
    finalGrades: Object.fromEntries(teacherEvaluation.data.evaluation.jobs.map((job) => [
      job.classJobId,
      job.recommendedGrade,
    ])),
  },
});
await request(`${monthlyBasePath}/close`, {
  cookie: teacherCookie,
  method: "POST",
  body: { expectedSourcePeriodId: monthlyBeforeEvaluation.data.sourcePeriod.id },
  expected: 201,
});
await request(`${monthlyBasePath}/start`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
  expected: 201,
});
const monthlyStarted = await request(monthlyBasePath, { cookie: teacherCookie });
assert.equal(monthlyStarted.data.session.orderMode, "shuffled");
assert.equal(monthlyStarted.data.session.order.length, jobRoster.data.students.length);
const monthlyReloaded = await request(monthlyBasePath, { cookie: teacherCookie });
assert.deepEqual(monthlyReloaded.data.session.order, monthlyStarted.data.session.order);
await request(`/api/classes/${jobClassId}/job-evaluation`, {
  cookie: outsiderCookie,
  expected: 404,
});

const verification = await request(`/api/registration/verify?token=${encodeURIComponent(activationToken)}`);
assert.equal(verification.data.student.official_name, "김하늘");
assert.equal(verification.data.student.student_number, 1);

const activated = await request("/api/registration/complete", {
  method: "POST",
  body: { token: activationToken, password: "1357" },
});
let studentCookie = cookieFrom(activated.response);
const reusedActivation = await request("/api/registration/complete", {
  method: "POST",
  body: { token: activationToken, password: "2468" },
});
studentCookie = cookieFrom(reusedActivation.response);

const me = await request("/api/student/me", { cookie: studentCookie });
assert.equal(me.data.student.id, student.id);

await request(`/api/classes/${classId}/students`, {
  cookie: outsiderCookie,
  expected: 404,
});
await request(`/api/classes/${jobClassId}/job-setup`, {
  cookie: outsiderCookie,
  expected: 404,
});
await request(`/api/classes/${jobClassId}/job-setup/draft`, {
  cookie: outsiderCookie,
  method: "PUT",
  body: {
    expectedRevision: 2,
    setupMode: "manual",
    surveyAnswers,
    jobs: jobsToComplete,
    lastStep: 3,
  },
  expected: 404,
});

await request(`/api/classes/${jobClassId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: { students: [{ number: 27, name: "추가학생" }] },
  expected: 201,
});
const changedSetup = await request(`/api/classes/${jobClassId}/job-setup`, { cookie: teacherCookie });
assert.equal(changedSetup.data.studentCount, 27);
assert.equal(changedSetup.data.studentCountChanged, true);
const classSummary = await request("/api/classes", { cookie: teacherCookie });
const jobSummary = classSummary.data.classes.find((item) => item.id === jobClassId);
assert.equal(jobSummary.job_status, "completed");
assert.equal(jobSummary.job_student_count_changed, 1);

await request(`/api/students/${student.id}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "locked" },
});
await request("/api/student/me", { cookie: studentCookie, expected: 401 });
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
  expected: 401,
});
await request(`/api/students/${student.id}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "active" },
});

const relogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
});
studentCookie = cookieFrom(relogin.response);

const resetCard = await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
await request("/api/student/me", { cookie: studentCookie, expected: 401 });
const resetToken = new URL(resetCard.data.card.activation_url).searchParams.get("token");
await request(`/api/registration/verify?token=${encodeURIComponent(activationToken)}`, {
  expected: 410,
});
await request("/api/registration/complete", {
  method: "POST",
  body: { token: resetToken, password: "9753" },
});
await request("/api/registration/complete", {
  method: "POST",
  body: { token: resetToken, password: "8642" },
});
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "8642" },
});

const recovery = await request("/api/teacher/password/request", {
  method: "POST",
  body: { email: teacherEmail },
});
assert.equal(recovery.data.emailConfigured, false);
assert.ok(recovery.data.developmentResetUrl);
const teacherResetToken = new URL(recovery.data.developmentResetUrl).searchParams.get("token");
await request("/api/teacher/password/reset", {
  method: "POST",
  body: { token: teacherResetToken, password: nextPassword },
});
await request("/api/classes", { cookie: teacherCookie, expected: 401 });
const teacherLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: nextPassword },
});
teacherCookie = cookieFrom(teacherLogin.response);
const finalRoster = await request(`/api/classes/${classId}/students`, { cookie: teacherCookie });
assert.equal(finalRoster.data.students[0].id, student.id);
assert.equal(finalRoster.data.students[0].official_name, "김하늘");
await request("/api/admin/dashboard", { cookie: teacherCookie, expected: 401 });

await request("/api/admin/teachers", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: signup.data.teacher.id, action: "revoke", note: "통합 테스트 권한 회수" },
});
await request("/api/classes", { cookie: teacherCookie, expected: 401 });
await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: nextPassword },
  expected: 200,
}).then(({ response }) => request("/api/classes", {
  cookie: cookieFrom(response),
  method: "POST",
  body: { schoolYear: 2099, grade: 6, classNumber: 30 },
  expected: 403,
}));
await request("/api/admin/teachers", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: signup.data.teacher.id, action: "reapprove", note: "통합 테스트 재승인" },
});
const restoredLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: nextPassword },
});
await request("/api/classes", { cookie: cookieFrom(restoredLogin.response) });

console.log("통합 흐름 검증 완료: 이메일·초대코드·학교·학급·학생·직업·첫 배정·권한·기존 흐름");

import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const teacherEmail = `teacher-${runId}@example.test`;
const secondTeacherEmail = `other-${runId}@example.test`;
const schoolName = `검증초${runId.slice(-6)}`;
const firstPassword = "Teacher!234";
const nextPassword = "Teacher!567";
const finalPassword = "Teacher!890";
const adminUsername = process.env.SYSTEM_ADMIN_USERNAME;
const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD;
const adminPath = process.env.SYSTEM_ADMIN_PATH;
const crossSiteHeaders = {
  origin: "https://attacker.example",
  "sec-fetch-site": "cross-site",
};
assert.ok(adminUsername && adminPassword && adminPath, "시스템 관리자 통합 테스트 환경 변수가 필요합니다.");

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  return value?.split(";")[0] || "";
}

function activationTokenFrom(url) {
  const parsed = new URL(url);
  return new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token")
    ?? parsed.searchParams.get("token");
}

function capacityOf(jobs) {
  return jobs.reduce((sum, job) => sum + job.memberCapacity, 0);
}

async function request(path, { cookie = "", method = "GET", body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-forwarded-for": `integration-${runId}`,
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
const parallelAdminFailures = await Promise.all(Array.from({ length: 8 }, (_, index) => (
  fetch(`${baseUrl}/api/admin/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `admin-login-${runId}-${index}`,
    },
    body: JSON.stringify({ username: `blocked-${runId}`, password: "wrong-password" }),
  })
)));
assert.deepEqual(
  parallelAdminFailures.map((response) => response.status).sort(),
  [401, 401, 401, 401, 401, 401, 401, 429],
  "관리자 로그인 동시 요청도 원자적으로 제한한다",
);
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
  expected: 202,
});
assert.equal(cookieFrom(signup.response), "");
const initialTeacherLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
});
let teacherCookie = cookieFrom(initialTeacherLogin.response);
const primaryTeacherId = initialTeacherLogin.data.teacher.id;
assert.match(teacherCookie, /^job_classroom_session=/);
await request("/api/teacher/email-verification/request", {
  cookie: teacherCookie,
  method: "POST",
  headers: crossSiteHeaders,
  expected: 403,
});
const initialVerification = await request("/api/teacher/email-verification/request", {
  cookie: teacherCookie,
  method: "POST",
});
assert.ok(initialVerification.data.verification?.developmentUrl);
const secondaryPendingLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
});
const secondaryPendingCookie = cookieFrom(secondaryPendingLogin.response);
assert.notEqual(secondaryPendingCookie, teacherCookie);
await request("/api/session", {
  cookie: teacherCookie,
  method: "DELETE",
  headers: crossSiteHeaders,
  expected: 403,
});
const sessionAfterBlockedLogout = await request("/api/session", { cookie: teacherCookie });
assert.equal(sessionAfterBlockedLogout.data.actor.id, primaryTeacherId);

await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2099, grade: 5, classNumber: 9 },
  expected: 403,
});
const emailToken = new URL(initialVerification.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
const preEmailVerificationCookie = teacherCookie;
const emailConfirmation = await request("/api/teacher/email-verification/confirm", {
  cookie: teacherCookie,
  method: "POST",
  body: { token: emailToken },
});
teacherCookie = cookieFrom(emailConfirmation.response);
assert.match(teacherCookie, /^job_classroom_session=/);
assert.notEqual(teacherCookie, preEmailVerificationCookie);
await request("/api/classes", { cookie: preEmailVerificationCookie, expected: 401 });
await request("/api/classes", { cookie: secondaryPendingCookie, expected: 401 });
await request("/api/teacher/email-verification/confirm", {
  cookie: teacherCookie,
  method: "POST",
  body: { token: emailToken },
  expected: 410,
});
await request("/api/session", { cookie: teacherCookie });

const outsider = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: secondTeacherEmail, password: firstPassword },
  expected: 202,
});
assert.equal(cookieFrom(outsider.response), "");
const outsiderLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: secondTeacherEmail, password: firstPassword },
});
let outsiderCookie = cookieFrom(outsiderLogin.response);
const outsiderVerification = await request("/api/teacher/email-verification/request", {
  cookie: outsiderCookie,
  method: "POST",
});
assert.ok(outsiderVerification.data.verification?.developmentUrl);
const outsiderEmailToken = new URL(outsiderVerification.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
const preOutsiderVerificationCookie = outsiderCookie;
const crossAccountConfirmation = await request("/api/teacher/email-verification/confirm", {
  cookie: teacherCookie,
  method: "POST",
  body: { token: outsiderEmailToken },
});
assert.equal(cookieFrom(crossAccountConfirmation.response), "");
await request("/api/session", { cookie: teacherCookie });
await request("/api/classes", { cookie: preOutsiderVerificationCookie, expected: 401 });
const verifiedOutsiderLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: secondTeacherEmail, password: firstPassword },
});
outsiderCookie = cookieFrom(verifiedOutsiderLogin.response);
const parallelSignupPasswordFailures = await Promise.all(Array.from({ length: 5 }, (_, index) => (
  fetch(`${baseUrl}/api/teacher/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `teacher-signup-subject-${runId}-${index}`,
    },
    body: JSON.stringify({ email: secondTeacherEmail, password: "wrong-password" }),
  })
)));
assert.deepEqual(
  parallelSignupPasswordFailures.map((response) => response.status).sort(),
  [202, 202, 202, 202, 429],
  "여러 IP에서도 같은 미인증 가입 이메일의 비밀번호 추측을 제한한다",
);
for (const response of parallelSignupPasswordFailures.filter((item) => item.status === 202)) {
  assert.equal(cookieFrom(response), "");
  const duplicateBody = await response.json();
  assert.equal(duplicateBody.accepted, outsider.data.accepted);
  assert.equal(duplicateBody.message, outsider.data.message);
  assert.deepEqual(Object.keys(duplicateBody).sort(), Object.keys(outsider.data).sort());
}
const parallelTeacherFailures = await Promise.all(Array.from({ length: 8 }, (_, index) => (
  fetch(`${baseUrl}/api/teacher/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `teacher-login-${runId}-${index}`,
    },
    body: JSON.stringify({ email: secondTeacherEmail, password: "wrong-password" }),
  })
)));
assert.deepEqual(
  parallelTeacherFailures.map((response) => response.status).sort(),
  [401, 401, 401, 401, 401, 401, 401, 429],
  "교사 비밀번호 동시 추측도 원자적으로 제한한다",
);
const signupFlood = await Promise.all(Array.from({ length: 21 }, (_, index) => (
  fetch(`${baseUrl}/api/teacher/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `teacher-signup-${runId}`,
    },
    body: JSON.stringify({
      email: `signup-limit-${index}-${runId}@example.test`,
      password: firstPassword,
    }),
  })
)));
assert.deepEqual(
  signupFlood.map((response) => response.status).sort(),
  [...Array(20).fill(202), 429],
  "이메일을 바꿔도 한 IP의 익명 가입 생성량을 제한한다",
);
const distributedPasswordRequests = await Promise.all(Array.from({ length: 6 }, (_, index) => (
  fetch(`${baseUrl}/api/teacher/password/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `password-request-${runId}-${index}`,
    },
    body: JSON.stringify({ email: `password-limit-${runId}@example.test` }),
  })
)));
assert.deepEqual(
  distributedPasswordRequests.map((response) => response.status).sort(),
  [200, 200, 200, 200, 200, 429],
  "여러 IP에서도 같은 이메일의 비밀번호 재설정 요청을 제한한다",
);
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
const secondaryPreInviteLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
});
const secondaryPreInviteCookie = cookieFrom(secondaryPreInviteLogin.response);
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
const cookiesBeforeInvite = [teacherCookie, outsiderCookie];
const cookiesAfterInvite = [];
for (const [index, response] of parallelRedeem.entries()) {
  let nextCookie = cookieFrom(response);
  if (response.status !== 200) {
    const replacement = await request("/api/admin/invite-codes", {
      cookie: adminCookie,
      method: "POST",
      headers: { "x-admin-csrf": adminCsrf },
      body: { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
      expected: 201,
    });
    const redeemed = await request("/api/teacher/invite-code/redeem", {
      cookie: cookiesBeforeInvite[index],
      method: "POST",
      body: { code: replacement.data.code },
    });
    nextCookie = cookieFrom(redeemed.response);
  }
  assert.match(nextCookie, /^job_classroom_session=/);
  assert.notEqual(nextCookie, cookiesBeforeInvite[index]);
  await request("/api/classes", { cookie: cookiesBeforeInvite[index], expected: 401 });
  cookiesAfterInvite[index] = nextCookie;
}
teacherCookie = cookiesAfterInvite[0];
outsiderCookie = cookiesAfterInvite[1];
await request("/api/classes", { cookie: secondaryPreInviteCookie, expected: 401 });
const secondaryPreSchoolLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
});
const secondaryPreSchoolCookie = cookieFrom(secondaryPreSchoolLogin.response);
const teacherSchoolSelection = await request("/api/schools/select", { cookie: teacherCookie, method: "POST", body: { schoolId } });
const teacherCookieBeforeSchool = teacherCookie;
teacherCookie = cookieFrom(teacherSchoolSelection.response);
assert.notEqual(teacherCookie, teacherCookieBeforeSchool);
await request("/api/classes", { cookie: teacherCookieBeforeSchool, expected: 401 });
await request("/api/classes", { cookie: secondaryPreSchoolCookie, expected: 401 });
const outsiderSchoolSelection = await request("/api/schools/select", { cookie: outsiderCookie, method: "POST", body: { schoolId } });
const outsiderCookieBeforeSchool = outsiderCookie;
outsiderCookie = cookieFrom(outsiderSchoolSelection.response);
assert.notEqual(outsiderCookie, outsiderCookieBeforeSchool);
await request("/api/classes", { cookie: outsiderCookieBeforeSchool, expected: 401 });

const manualSignup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: `manual-${runId}@example.test`, password: firstPassword },
  expected: 202,
});
assert.equal(cookieFrom(manualSignup.response), "");
const manualEmail = `manual-${runId}@example.test`;
const manualLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: manualEmail, password: firstPassword },
});
let manualCookie = cookieFrom(manualLogin.response);
const manualVerification = await request("/api/teacher/email-verification/request", {
  cookie: manualCookie,
  method: "POST",
});
const manualEmailToken = new URL(manualVerification.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
const manualConfirmation = await request("/api/teacher/email-verification/confirm", {
  cookie: manualCookie,
  method: "POST",
  body: { token: manualEmailToken },
});
manualCookie = cookieFrom(manualConfirmation.response);
const manualInvite = await request("/api/admin/invite-codes", {
  cookie: adminCookie,
  method: "POST",
  headers: { "x-admin-csrf": adminCsrf },
  body: { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
  expected: 201,
});
const manualInviteRedemption = await request("/api/teacher/invite-code/redeem", {
  cookie: manualCookie,
  method: "POST",
  body: { code: manualInvite.data.code },
});
manualCookie = cookieFrom(manualInviteRedemption.response);
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
const manualCookieBeforeSchool = manualCookie;
manualCookie = cookieFrom(manualRequest.response);
assert.notEqual(manualCookie, manualCookieBeforeSchool);
await request("/api/classes", { cookie: manualCookieBeforeSchool, expected: 401 });
await request("/api/admin/school-requests", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: manualRequest.data.request.id, action: "approve_new", note: "통합 테스트 신규 학교 승인" },
});
const manualSession = await request("/api/session", { cookie: manualCookie });
assert.ok(manualSession.data.actor.school_id);
assert.equal(manualSession.data.actor.manual_school_request_id, null);
const requestToReject = await request("/api/schools/manual", {
  cookie: manualCookie,
  method: "POST",
  body: {
    enteredName: `거절학교${runId.slice(-4)}`,
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "확인불가",
  },
  expected: 201,
});
manualCookie = cookieFrom(requestToReject.response);
await request("/api/classes", { cookie: manualCookie });
await request("/api/admin/school-requests", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: requestToReject.data.request.id, action: "reject", note: "통합 테스트 반려" },
});
await request("/api/classes", { cookie: manualCookie, expected: 401 });
const rejectedTeacherLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: manualEmail, password: firstPassword },
});
const rejectedTeacherCookie = cookieFrom(rejectedTeacherLogin.response);
const rejectedTeacherSession = await request("/api/session", { cookie: rejectedTeacherCookie });
assert.equal(rejectedTeacherSession.data.actor.school_id, null);
assert.equal(rejectedTeacherSession.data.actor.manual_school_request_id, null);
await request("/api/classes", { cookie: rejectedTeacherCookie, expected: 403 });
const concurrentReviewRequest = await request("/api/schools/manual", {
  cookie: rejectedTeacherCookie,
  method: "POST",
  body: {
    enteredName: `동시검토학교${runId.slice(-4)}`,
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "동시검토구",
  },
  expected: 201,
});
const concurrentReviewCookie = cookieFrom(concurrentReviewRequest.response);
const concurrentReviewId = concurrentReviewRequest.data.request.id;
const concurrentReviews = await Promise.all([
  fetch(`${baseUrl}/api/admin/school-requests`, {
    method: "PATCH",
    headers: {
      cookie: adminCookie,
      "content-type": "application/json",
      "x-admin-csrf": adminCsrf,
    },
    body: JSON.stringify({ id: concurrentReviewId, action: "link", schoolId, note: "동시 연결" }),
  }),
  fetch(`${baseUrl}/api/admin/school-requests`, {
    method: "PATCH",
    headers: {
      cookie: adminCookie,
      "content-type": "application/json",
      "x-admin-csrf": adminCsrf,
    },
    body: JSON.stringify({ id: concurrentReviewId, action: "reject", note: "동시 반려" }),
  }),
]);
assert.deepEqual(concurrentReviews.map((response) => response.status).sort(), [200, 409]);
if (concurrentReviews[0].status === 200) {
  const linkedSession = await request("/api/session", { cookie: concurrentReviewCookie });
  assert.equal(linkedSession.data.actor.school_id, schoolId);
  assert.equal(linkedSession.data.actor.manual_school_request_id, null);
} else {
  await request("/api/classes", { cookie: concurrentReviewCookie, expected: 401 });
  const afterConcurrentReject = await request("/api/teacher/login", {
    method: "POST",
    body: { email: manualEmail, password: firstPassword },
  });
  await request("/api/classes", { cookie: cookieFrom(afterConcurrentReject.response), expected: 403 });
}

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
const activationToken = activationTokenFrom(student.activation_url);
assert.ok(activationToken);
await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  headers: crossSiteHeaders,
  expected: 403,
});
await request(`/api/classes/${classId}/registration-tokens`, {
  cookie: teacherCookie,
  method: "POST",
  headers: crossSiteHeaders,
  expected: 403,
});
const qrCrossSiteIp = `qr-cross-site-${runId}`;
const crossSiteQrAttempts = await Promise.all(Array.from({ length: 121 }, () => (
  fetch(`${baseUrl}/api/registration/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...crossSiteHeaders,
      "x-forwarded-for": qrCrossSiteIp,
    },
    body: JSON.stringify({ token: "invalid" }),
  })
)));
assert.ok(crossSiteQrAttempts.every((response) => response.status === 403));
await request("/api/registration/verify", {
  method: "POST",
  headers: { "x-forwarded-for": qrCrossSiteIp },
  body: { token: "invalid" },
  expected: 400,
});

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
  { cookie: teacherCookie, method: "DELETE", headers: crossSiteHeaders, expected: 403 },
);
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
const evaluationActivationToken = activationTokenFrom(evaluationStudent.activation_url);
assert.ok(evaluationActivationToken);
const evaluationVerification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: evaluationActivationToken },
});
const evaluationActivation = await request("/api/registration/complete", {
  cookie: cookieFrom(evaluationVerification.response),
  method: "POST",
  body: { password: "3579" },
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

const verification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: activationToken },
});
assert.equal(verification.data.student.official_name, "김하늘");
assert.equal(verification.data.student.student_number, 1);
assert.equal(verification.data.mode, "activate");

const activated = await request("/api/registration/complete", {
  cookie: cookieFrom(verification.response),
  method: "POST",
  body: { password: "1357" },
});
let studentCookie = cookieFrom(activated.response);
await request("/api/registration/complete", {
  cookie: cookieFrom(verification.response),
  method: "POST",
  body: { password: "2468" },
  expected: 410,
});
await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: outsiderCookie,
  method: "POST",
  body: {},
  expected: 404,
});
await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const resetVerification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: activationToken },
});
assert.equal(resetVerification.data.mode, "reset");
const resetWithSameQr = await request("/api/registration/complete", {
  cookie: cookieFrom(resetVerification.response),
  method: "POST",
  body: { password: "2468" },
});
studentCookie = cookieFrom(resetWithSameQr.response);

const me = await request("/api/student/me", { cookie: studentCookie });
assert.equal(me.data.student.id, student.id);

await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
  expected: 400,
});
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2098, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
  expected: 401,
});

const previousYearClass = await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolYear: 2098, grade: 5, classNumber: 9, displayName: "previous-year-login-check" },
  expected: 201,
});
const previousYearRoster = await request(`/api/classes/${previousYearClass.data.class.id}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: { students: [{ number: 1, name: "previous-year-student" }] },
  expected: 201,
});
const previousYearStudent = previousYearRoster.data.students[0];
const previousYearToken = activationTokenFrom(previousYearStudent.activation_url);
assert.ok(previousYearToken);
const previousYearVerification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: previousYearToken },
});
await request("/api/registration/complete", {
  cookie: cookieFrom(previousYearVerification.response),
  method: "POST",
  body: { password: "2468" },
});
const previousYearLogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2098, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
});
const previousYearCookie = cookieFrom(previousYearLogin.response);
const previousYearMe = await request("/api/student/me", { cookie: previousYearCookie });
assert.equal(previousYearMe.data.student.id, previousYearStudent.id);
const currentYearLogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
});
const currentYearCookie = cookieFrom(currentYearLogin.response);
const currentYearMe = await request("/api/student/me", { cookie: currentYearCookie });
assert.equal(currentYearMe.data.student.id, student.id);
assert.notEqual(previousYearMe.data.student.id, currentYearMe.data.student.id);

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
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
  expected: 401,
});
await request(`/api/students/${student.id}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "active" },
});

const relogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
});
studentCookie = cookieFrom(relogin.response);

const resetCard = await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
await request("/api/student/me", { cookie: studentCookie, expected: 401 });
const resetToken = activationTokenFrom(resetCard.data.card.activation_url);
await request("/api/registration/verify", {
  method: "POST",
  body: { token: activationToken },
  expected: 410,
});
const replacementVerification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: resetToken },
});
assert.equal(replacementVerification.data.mode, "login");
await request("/api/registration/complete", {
  cookie: cookieFrom(replacementVerification.response),
  method: "POST",
  body: { password: "2468" },
});
await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const replacementResetVerification = await request("/api/registration/verify", {
  method: "POST",
  body: { token: resetToken },
});
assert.equal(replacementResetVerification.data.mode, "reset");
await request("/api/registration/complete", {
  cookie: cookieFrom(replacementResetVerification.response),
  method: "POST",
  body: { password: "9753" },
});
await request("/api/registration/complete", {
  cookie: cookieFrom(replacementResetVerification.response),
  method: "POST",
  body: { password: "8642" },
  expected: 410,
});
const unaffectedStudentLogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9, studentNumber: 1, password: "9753" },
});
const unaffectedStudentCookie = cookieFrom(unaffectedStudentLogin.response);

const recovery = await request("/api/teacher/password/request", {
  method: "POST",
  body: { email: teacherEmail },
});
assert.equal(recovery.data.emailConfigured, false);
assert.ok(recovery.data.developmentResetUrl);
const missingRecovery = await request("/api/teacher/password/request", {
  method: "POST",
  body: { email: `missing-reset-${runId}@example.test` },
});
assert.equal(missingRecovery.data.message, recovery.data.message);
assert.equal(missingRecovery.data.ok, recovery.data.ok);
assert.equal(missingRecovery.data.emailConfigured, recovery.data.emailConfigured);
assert.deepEqual(Object.keys(missingRecovery.data).sort(), Object.keys(recovery.data).sort());
assert.ok(missingRecovery.data.developmentResetUrl);
const missingResetToken = new URL(missingRecovery.data.developmentResetUrl).searchParams.get("token");
await request("/api/teacher/password/reset", {
  method: "POST",
  body: { token: missingResetToken, password: "Missing!234" },
  expected: 410,
});
const teacherResetToken = new URL(recovery.data.developmentResetUrl).searchParams.get("token");
await request("/api/teacher/password/reset", {
  method: "POST",
  body: { token: teacherResetToken, password: nextPassword },
});
await request("/api/classes", { cookie: teacherCookie, expected: 401 });
const raceRecovery = await request("/api/teacher/password/request", {
  method: "POST",
  body: { email: teacherEmail },
});
const raceResetToken = new URL(raceRecovery.data.developmentResetUrl).searchParams.get("token");
const [racingTeacherLogin, racingTeacherReset] = await Promise.all([
  fetch(`${baseUrl}/api/teacher/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: teacherEmail, password: nextPassword }),
  }),
  fetch(`${baseUrl}/api/teacher/password/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: raceResetToken, password: finalPassword }),
  }),
]);
assert.equal(racingTeacherReset.status, 200);
assert.ok([200, 401].includes(racingTeacherLogin.status));
const racingTeacherCookie = cookieFrom(racingTeacherLogin);
if (racingTeacherCookie) {
  await request("/api/classes", { cookie: racingTeacherCookie, expected: 401 });
}
await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: nextPassword },
  expected: 401,
});
const teacherLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: finalPassword },
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
  body: { id: primaryTeacherId, action: "revoke", note: "통합 테스트 권한 회수" },
});
await request("/api/classes", { cookie: teacherCookie, expected: 401 });
const revokedLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: finalPassword },
  expected: 401,
});
const revokedCookie = cookieFrom(revokedLogin.response);
assert.equal(revokedCookie, "");
assert.equal(revokedLogin.data.code, "LOGIN_FAILED");
await request("/api/admin/teachers", {
  cookie: adminCookie,
  method: "PATCH",
  headers: { "x-admin-csrf": adminCsrf },
  body: { id: primaryTeacherId, action: "reapprove", note: "통합 테스트 재승인" },
});
await request("/api/classes", { cookie: teacherCookie, expected: 401 });
const reapprovedLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: finalPassword },
});
const reapprovedCookie = cookieFrom(reapprovedLogin.response);
const restoredRoster = await request(`/api/classes/${classId}/students`, { cookie: reapprovedCookie });
assert.equal(restoredRoster.data.class.display_name, finalRoster.data.class.display_name);
assert.equal(restoredRoster.data.students.some((row) => row.student_number === 99), false);

const [, racingArchivedLogin] = await Promise.all([
  request(`/api/classes/${previousYearClass.data.class.id}`, {
    cookie: reapprovedCookie,
    method: "PATCH",
    body: { status: "archived" },
  }),
  fetch(`${baseUrl}/api/student/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `archive-race-${runId}`,
    },
    body: JSON.stringify({
      schoolName,
      schoolYear: 2098,
      grade: 5,
      classNumber: 9,
      studentNumber: 1,
      password: "2468",
    }),
  }),
]);
assert.ok([200, 401].includes(racingArchivedLogin.status));
const racingArchivedCookie = cookieFrom(racingArchivedLogin);
await request("/api/student/me", { cookie: previousYearCookie, expected: 401 });
if (racingArchivedCookie) {
  await request("/api/student/me", { cookie: racingArchivedCookie, expected: 401 });
}
const archivedActor = await request("/api/session", { cookie: previousYearCookie });
assert.equal(archivedActor.data.actor, null);
await request("/api/announcements", { cookie: previousYearCookie, expected: 401 });
await request("/api/student/me", { cookie: unaffectedStudentCookie });
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2098, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
  expected: 401,
});
await request(`/api/classes/${previousYearClass.data.class.id}`, {
  cookie: reapprovedCookie,
  method: "PATCH",
  body: { status: "active" },
});
await request("/api/student/me", { cookie: previousYearCookie, expected: 401 });
if (racingArchivedCookie) {
  await request("/api/student/me", { cookie: racingArchivedCookie, expected: 401 });
}
const reactivatedStudentLogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, schoolYear: 2098, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
});
await request("/api/student/me", { cookie: cookieFrom(reactivatedStudentLogin.response) });

console.log("통합 흐름 검증 완료: 이메일·초대코드·학교·학급·학생·직업·첫 배정·권한·기존 흐름");

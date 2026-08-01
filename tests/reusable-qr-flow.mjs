import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const adminUsername = process.env.SYSTEM_ADMIN_USERNAME;
const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD;
assert.ok(adminUsername && adminPassword, "시스템 관리자 테스트 자격 증명이 필요합니다.");

const runNumber = Date.now();
const teacherEmail = `reusable-qr-${runNumber}@example.test`;
const teacherPassword = "Teacher!234";

function responseCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function activationTokenFrom(url) {
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.has("token"), false, "장기 QR 토큰은 query string에 두지 않는다");
  return new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token");
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

async function verifyQr(token, expectedMode) {
  const verified = await request("/api/registration/verify", {
    method: "POST",
    body: { token },
  });
  assert.equal(verified.data.mode, expectedMode);
  const setCookie = verified.response.headers.get("set-cookie") || "";
  assert.match(setCookie, /job_classroom_registration_challenge=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/api\/registration/i);
  assert.match(verified.response.headers.get("cache-control") || "", /no-store/i);
  return { ...verified, cookie: responseCookie(verified.response) };
}

const adminLogin = await request("/api/admin/auth/login", {
  method: "POST",
  body: { username: adminUsername, password: adminPassword },
});
const adminCookie = responseCookie(adminLogin.response);
const invite = await request("/api/admin/invite-codes", {
  cookie: adminCookie,
  method: "POST",
  headers: { "x-admin-csrf": adminLogin.data.csrfToken },
  body: { expiresAt: Date.now() + 60 * 60 * 1000 },
  expected: 201,
});

const signup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: teacherEmail, password: teacherPassword },
  expected: 201,
});
const teacherCookie = responseCookie(signup.response);
const emailToken = new URL(signup.data.verification.developmentUrl).searchParams.get("verifyEmailToken");
await request("/api/teacher/email-verification/confirm", {
  method: "POST",
  body: { token: emailToken },
});
await request("/api/teacher/invite-code/redeem", {
  cookie: teacherCookie,
  method: "POST",
  body: { code: invite.data.code },
});

const schools = await request(`/api/schools/search?q=${encodeURIComponent("서이초")}`, {
  cookie: teacherCookie,
});
await request("/api/schools/select", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolId: schools.data.schools[0].id },
});

const classCreated = await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: {
    schoolYear: 2040 + (runNumber % 60),
    grade: 1 + (runNumber % 6),
    classNumber: 1 + (runNumber % 30),
    displayName: "재사용 QR 검증반",
  },
  expected: 201,
});
const classId = classCreated.data.class.id;
const roster = await request(`/api/classes/${classId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    students: [
      { number: 1, name: "재사용학생" },
      { number: 2, name: "동시요청학생" },
    ],
  },
  expected: 201,
});
const student = roster.data.students[0];
const originalToken = activationTokenFrom(student.activation_url);
assert.ok(originalToken);

const firstVerification = await verifyQr(originalToken, "activate");
assert.equal(firstVerification.data.student.student_number, 1);

const parallelActivation = await Promise.all([
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: firstVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "1357" }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: firstVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "1357" }),
  }),
]);
assert.deepEqual(parallelActivation.map((response) => response.status).sort(), [200, 410]);
const activationSuccess = parallelActivation.find((response) => response.status === 200);
assert.ok(activationSuccess);
const firstStudentCookie = responseCookie(activationSuccess);
await request("/api/student/me", { cookie: firstStudentCookie });

const loginVerification = await verifyQr(originalToken, "login");
await request("/api/registration/complete", {
  cookie: loginVerification.cookie,
  method: "POST",
  body: { password: "2468" },
  expected: 401,
});
const qrLogin = await request("/api/registration/complete", {
  cookie: loginVerification.cookie,
  method: "POST",
  body: { password: "1357" },
});
const secondStudentCookie = responseCookie(qrLogin.response);
await request("/api/student/me", { cookie: secondStudentCookie });

const staleLoginVerification = await verifyQr(originalToken, "login");
const grant = await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
assert.ok(grant.data.expiresAt > Date.now());
await request("/api/registration/complete", {
  cookie: staleLoginVerification.cookie,
  method: "POST",
  body: { password: "1357" },
  expected: 410,
});

const resetVerification = await verifyQr(originalToken, "reset");
const competingResetVerification = await verifyQr(originalToken, "reset");
const parallelReset = await Promise.all([
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: resetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "2468" }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: competingResetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "2468" }),
  }),
]);
assert.deepEqual(parallelReset.map((response) => response.status).sort(), [200, 410]);
const resetSuccess = parallelReset.find((response) => response.status === 200);
assert.ok(resetSuccess);
const resetStudentCookie = responseCookie(resetSuccess);
await request("/api/student/me", { cookie: firstStudentCookie, expected: 401 });
await request("/api/student/me", { cookie: secondStudentCookie, expected: 401 });
await request("/api/student/me", { cookie: resetStudentCookie });
await request("/api/registration/complete", {
  cookie: resetVerification.cookie,
  method: "POST",
  body: { password: "8642" },
  expected: 410,
});

const afterResetLogin = await verifyQr(originalToken, "login");
await request("/api/registration/complete", {
  cookie: afterResetLogin.cookie,
  method: "POST",
  body: { password: "1357" },
  expected: 401,
});
await request("/api/registration/complete", {
  cookie: afterResetLogin.cookie,
  method: "POST",
  body: { password: "2468" },
});

await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const raceResetVerification = await verifyQr(originalToken, "reset");
const [racingPasswordLogin, racingReset] = await Promise.all([
  fetch(`${baseUrl}/api/student/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schoolName: classCreated.data.class.school_name,
      schoolYear: classCreated.data.class.school_year,
      grade: classCreated.data.class.grade,
      classNumber: classCreated.data.class.class_number,
      studentNumber: student.student_number,
      password: "2468",
    }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: raceResetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "8642" }),
  }),
]);
assert.equal(racingReset.status, 200);
assert.ok([200, 401].includes(racingPasswordLogin.status));
const racingLoginCookie = responseCookie(racingPasswordLogin);
if (racingLoginCookie) {
  await request("/api/student/me", { cookie: racingLoginCookie, expected: 401 });
}
await request("/api/student/login", {
  method: "POST",
  body: {
    schoolName: classCreated.data.class.school_name,
    schoolYear: classCreated.data.class.school_year,
    grade: classCreated.data.class.grade,
    classNumber: classCreated.data.class.class_number,
    studentNumber: student.student_number,
    password: "2468",
  },
  expected: 401,
});

const challengeBeforeRotation = await verifyQr(originalToken, "login");
const replacement = await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const replacementToken = activationTokenFrom(replacement.data.card.activation_url);
await request("/api/registration/complete", {
  cookie: challengeBeforeRotation.cookie,
  method: "POST",
  body: { password: "8642" },
  expected: 410,
});
await request("/api/registration/verify", {
  method: "POST",
  body: { token: originalToken },
  expected: 410,
});
const replacementVerification = await verifyQr(replacementToken, "login");
const replacementPinLogin = await request("/api/registration/complete", {
  cookie: replacementVerification.cookie,
  method: "POST",
  body: { password: "8642" },
});
const replacementPinCookie = responseCookie(replacementPinLogin.response);
await request(`/api/students/${student.id}/qr-reset-grant`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const replacementReset = await verifyQr(replacementToken, "reset");
await request("/api/registration/complete", {
  cookie: replacementReset.cookie,
  method: "POST",
  body: { password: "9753" },
});
await request("/api/student/me", { cookie: replacementPinCookie, expected: 401 });
await request("/api/registration/complete", {
  cookie: replacementReset.cookie,
  method: "POST",
  body: { password: "8642" },
  expected: 410,
});
const replacementLogin = await verifyQr(replacementToken, "login");
await request("/api/registration/complete", {
  cookie: replacementLogin.cookie,
  method: "POST",
  body: { password: "9753" },
});

const limitedStudent = roster.data.students[1];
const limitedToken = activationTokenFrom(limitedStudent.activation_url);
const limitedActivation = await verifyQr(limitedToken, "activate");
await request("/api/registration/complete", {
  cookie: limitedActivation.cookie,
  method: "POST",
  body: { password: "1357" },
});
const limitedChallenges = [];
for (let index = 0; index < 8; index += 1) {
  limitedChallenges.push(await verifyQr(limitedToken, "login"));
}
const parallelWrongPins = await Promise.all(limitedChallenges.map((challenge) => fetch(
  `${baseUrl}/api/registration/complete`,
  {
    method: "POST",
    headers: { cookie: challenge.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "9999" }),
  },
)));
assert.deepEqual(
  parallelWrongPins.map((response) => response.status).sort(),
  [401, 401, 401, 401, 401, 401, 401, 429],
  "동시 PIN 요청도 원자적으로 시도 횟수를 제한한다",
);
for (let index = 0; index < 3; index += 1) {
  await verifyQr(limitedToken, "login");
}
await request("/api/registration/verify", {
  method: "POST",
  body: { token: limitedToken },
  expected: 429,
});

console.log("재사용 QR 통합 검증 완료: 활성화·PIN 로그인·10분 재설정·동시 처리·원자적 제한·QR 교체");

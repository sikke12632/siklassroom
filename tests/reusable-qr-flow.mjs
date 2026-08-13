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

function bearerTokenFromFragment(url, name) {
  const parsed = new URL(url);
  assert.equal(parsed.search, "", `${name} bearer token은 query string에 두지 않는다`);
  const token = new URLSearchParams(parsed.hash.replace(/^#/, "")).get(name);
  assert.ok(token, `${name} bearer token이 fragment에 있어야 한다`);
  return token;
}

async function request(path, { cookie = "", method = "GET", body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-forwarded-for": `reusable-qr-${runNumber}`,
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
  expected: 202,
});
assert.equal(responseCookie(signup.response), "");
const teacherLogin = await request("/api/teacher/login", {
  method: "POST",
  body: { email: teacherEmail, password: teacherPassword },
});
let teacherCookie = responseCookie(teacherLogin.response);
const verification = await request("/api/teacher/email-verification/request", {
  cookie: teacherCookie,
  method: "POST",
});
const emailToken = bearerTokenFromFragment(verification.data.verification.developmentUrl, "verifyEmailToken");
const cookieBeforeEmail = teacherCookie;
const confirmation = await request("/api/teacher/email-verification/confirm", {
  cookie: teacherCookie,
  method: "POST",
  body: { token: emailToken },
});
teacherCookie = responseCookie(confirmation.response);
assert.notEqual(teacherCookie, cookieBeforeEmail);
await request("/api/classes", { cookie: cookieBeforeEmail, expected: 401 });
const cookieBeforeInvite = teacherCookie;
const redeemed = await request("/api/teacher/invite-code/redeem", {
  cookie: teacherCookie,
  method: "POST",
  body: { code: invite.data.code },
});
teacherCookie = responseCookie(redeemed.response);
assert.notEqual(teacherCookie, cookieBeforeInvite);
await request("/api/classes", { cookie: cookieBeforeInvite, expected: 401 });

const schools = await request(`/api/schools/search?q=${encodeURIComponent("서이초")}`, {
  cookie: teacherCookie,
});
const cookieBeforeSchool = teacherCookie;
const selectedSchool = await request("/api/schools/select", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolId: schools.data.schools[0].id },
});
teacherCookie = responseCookie(selectedSchool.response);
assert.notEqual(teacherCookie, cookieBeforeSchool);
await request("/api/classes", { cookie: cookieBeforeSchool, expected: 401 });

let classCreated;
for (let attempt = 0; attempt < 30 && !classCreated; attempt += 1) {
  const seed = (runNumber + attempt * 7919) % (60 * 6 * 30);
  const response = await fetch(`${baseUrl}/api/classes`, {
    method: "POST",
    headers: { cookie: teacherCookie, "content-type": "application/json" },
    body: JSON.stringify({
      schoolYear: 2040 + (seed % 60),
      grade: 1 + (Math.floor(seed / 60) % 6),
      classNumber: 1 + (Math.floor(seed / (60 * 6)) % 30),
      displayName: "재사용 QR 검증반",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 201) classCreated = { response, data };
  else assert.equal(response.status, 409, `POST /api/classes: ${JSON.stringify(data)}`);
}
assert.ok(classCreated, "재사용 QR 검증용 빈 학급 조합을 찾는다");
const classId = classCreated.data.class.id;
const roster = await request(`/api/classes/${classId}/students`, {
  cookie: teacherCookie,
  method: "POST",
  body: {
    students: [
      { number: 1, name: "재사용학생" },
      { number: 2, name: "동시요청학생" },
      { number: 3, name: "동시로그인학생" },
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
    body: JSON.stringify({ password: "135790" }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: firstVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "135790" }),
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
  body: { password: "258025" },
  expected: 401,
});
const qrLogin = await request("/api/registration/complete", {
  cookie: loginVerification.cookie,
  method: "POST",
  body: { password: "135790" },
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
  body: { password: "135790" },
  expected: 410,
});

const resetVerification = await verifyQr(originalToken, "reset");
const competingResetVerification = await verifyQr(originalToken, "reset");
const parallelReset = await Promise.all([
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: resetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "258025" }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: competingResetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "258025" }),
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
  body: { password: "864209" },
  expected: 410,
});

const afterResetLogin = await verifyQr(originalToken, "login");
await request("/api/registration/complete", {
  cookie: afterResetLogin.cookie,
  method: "POST",
  body: { password: "135790" },
  expected: 401,
});
await request("/api/registration/complete", {
  cookie: afterResetLogin.cookie,
  method: "POST",
  body: { password: "258025" },
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
      password: "258025",
    }),
  }),
  fetch(`${baseUrl}/api/registration/complete`, {
    method: "POST",
    headers: { cookie: raceResetVerification.cookie, "content-type": "application/json" },
    body: JSON.stringify({ password: "864209" }),
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
    password: "258025",
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
  body: { password: "864209" },
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
  body: { password: "864209" },
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
  body: { password: "975310" },
});
await request("/api/student/me", { cookie: replacementPinCookie, expected: 401 });
await request("/api/registration/complete", {
  cookie: replacementReset.cookie,
  method: "POST",
  body: { password: "864209" },
  expected: 410,
});
const replacementLogin = await verifyQr(replacementToken, "login");
await request("/api/registration/complete", {
  cookie: replacementLogin.cookie,
  method: "POST",
  body: { password: "975310" },
});

const limitedStudent = roster.data.students[1];
const limitedToken = activationTokenFrom(limitedStudent.activation_url);
const limitedActivation = await verifyQr(limitedToken, "activate");
await request("/api/registration/complete", {
  cookie: limitedActivation.cookie,
  method: "POST",
  body: { password: "135790" },
});
const distributedStudentLogins = await Promise.all(Array.from({ length: 8 }, (_, index) => fetch(
  `${baseUrl}/api/student/login`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `student-login-${runNumber}-${index}`,
    },
    body: JSON.stringify({
      schoolName: classCreated.data.class.school_name,
      schoolYear: classCreated.data.class.school_year,
      grade: classCreated.data.class.grade,
      classNumber: classCreated.data.class.class_number,
      studentNumber: limitedStudent.student_number,
      password: "9999",
    }),
  },
)));
assert.deepEqual(
  distributedStudentLogins.map((response) => response.status).sort(),
  [401, 401, 401, 401, 401, 401, 401, 429],
  "여러 IP에서도 같은 학생 계정의 PIN 추측을 제한한다",
);
await request("/api/student/login", {
  method: "POST",
  headers: { "x-forwarded-for": `student-login-${runNumber}-7` },
  body: {
    schoolName: classCreated.data.class.school_name,
    schoolYear: classCreated.data.class.school_year,
    grade: classCreated.data.class.grade,
    classNumber: classCreated.data.class.class_number,
    studentNumber: limitedStudent.student_number,
    password: "135790",
  },
  expected: 429,
});
const lockedAccountQr = await verifyQr(limitedToken, "login");
const lockedAccountQrLogin = await request("/api/registration/complete", {
  cookie: lockedAccountQr.cookie,
  method: "POST",
  body: { password: "135790" },
});
assert.match(responseCookie(lockedAccountQrLogin.response), /^job_classroom_session=/);

const concurrentStudent = roster.data.students[2];
const concurrentToken = activationTokenFrom(concurrentStudent.activation_url);
const concurrentActivation = await verifyQr(concurrentToken, "activate");
await request("/api/registration/complete", {
  cookie: concurrentActivation.cookie,
  method: "POST",
  body: { password: "246802" },
});
const concurrentPinAttempts = await Promise.all(Array.from({ length: 8 }, (_, index) => fetch(
  `${baseUrl}/api/student/login`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `concurrent-pin-${runNumber}-${index}`,
    },
    body: JSON.stringify({
      schoolName: classCreated.data.class.school_name,
      schoolYear: classCreated.data.class.school_year,
      grade: classCreated.data.class.grade,
      classNumber: classCreated.data.class.class_number,
      studentNumber: concurrentStudent.student_number,
      password: index === 7 ? "246802" : "9999",
    }),
  },
)));
const concurrentStatuses = concurrentPinAttempts.map((response) => response.status);
assert.equal(concurrentStatuses.filter((status) => status === 429).length, 1);
assert.ok(concurrentStatuses.every((status) => [200, 401, 429].includes(status)));
assert.ok(
  concurrentStatuses.filter((status) => status === 401).length <= 7,
  "동시에 보낸 PIN도 계정 시도권 일곱 개를 넘지 않아야 합니다.",
);
const limitedChallenges = [];
for (let index = 0; index < 8; index += 1) {
  limitedChallenges.push(await verifyQr(limitedToken, "login"));
}
const parallelWrongPins = await Promise.all(limitedChallenges.map((challenge, index) => fetch(
  `${baseUrl}/api/registration/complete`,
  {
    method: "POST",
    headers: {
      cookie: challenge.cookie,
      "content-type": "application/json",
      "x-forwarded-for": `qr-pin-${runNumber}-${index}`,
    },
    body: JSON.stringify({ password: "9999" }),
  },
)));
assert.deepEqual(
  parallelWrongPins.map((response) => response.status).sort(),
  [401, 401, 401, 401, 401, 401, 401, 429],
  "동시 PIN 요청도 원자적으로 시도 횟수를 제한한다",
);
for (let index = 0; index < 2; index += 1) {
  await verifyQr(limitedToken, "login");
}
await request("/api/registration/verify", {
  method: "POST",
  body: { token: limitedToken },
  expected: 429,
});

console.log("재사용 QR 통합 검증 완료: 활성화·PIN 로그인·10분 재설정·동시 처리·원자적 제한·QR 교체");

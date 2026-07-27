import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const inviteCode = process.env.TEST_INVITE_CODE;
assert.ok(inviteCode, "TEST_INVITE_CODE가 필요합니다.");

const runNumber = Date.now();
const teacherEmail = `reusable-qr-${runNumber}@example.test`;
const teacherPassword = "Teacher!234";

function responseCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function request(path, { cookie = "", method = "GET", body, expected = 200 } = {}) {
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
  return { response, data };
}

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
  body: { code: inviteCode },
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
  body: { students: [{ number: 1, name: "재사용학생" }] },
  expected: 201,
});
const student = roster.data.students[0];
const originalToken = new URL(student.activation_url).searchParams.get("token");

const firstVerification = await request(
  `/api/registration/verify?token=${encodeURIComponent(originalToken)}`,
);
assert.equal(firstVerification.data.isReturning, false);

const firstCompletion = await request("/api/registration/complete", {
  method: "POST",
  body: { token: originalToken, password: "1357" },
});
const firstStudentCookie = responseCookie(firstCompletion.response);

const reusedVerification = await request(
  `/api/registration/verify?token=${encodeURIComponent(originalToken)}`,
);
assert.equal(reusedVerification.data.isReturning, true);
const secondCompletion = await request("/api/registration/complete", {
  method: "POST",
  body: { token: originalToken, password: "2468" },
});
const secondStudentCookie = responseCookie(secondCompletion.response);
await request("/api/student/me", { cookie: firstStudentCookie, expected: 401 });
await request("/api/student/me", { cookie: secondStudentCookie });
await request("/api/student/login", {
  method: "POST",
  body: {
    schoolName: "서울서이초등학교",
    grade: classCreated.data.class.grade,
    classNumber: classCreated.data.class.class_number,
    studentNumber: 1,
    password: "1357",
  },
  expected: 401,
});
await request("/api/student/login", {
  method: "POST",
  body: {
    schoolName: "서울서이초등학교",
    grade: classCreated.data.class.grade,
    classNumber: classCreated.data.class.class_number,
    studentNumber: 1,
    password: "2468",
  },
});

const replacement = await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
const replacementToken = new URL(replacement.data.card.activation_url).searchParams.get("token");
await request(`/api/registration/verify?token=${encodeURIComponent(originalToken)}`, {
  expected: 410,
});
await request("/api/registration/complete", {
  method: "POST",
  body: { token: replacementToken, password: "9753" },
});
await request("/api/registration/complete", {
  method: "POST",
  body: { token: replacementToken, password: "8642" },
});

console.log("재사용 QR 통합 검증 완료: 반복 스캔·비밀번호 변경·세션 종료·재발급 시 이전 QR 무효화");

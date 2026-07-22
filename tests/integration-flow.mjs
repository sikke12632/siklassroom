import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const teacherEmail = `teacher-${runId}@example.test`;
const secondTeacherEmail = `other-${runId}@example.test`;
const schoolName = `검증초${runId.slice(-6)}`;
const firstPassword = "Teacher!234";
const nextPassword = "Teacher!567";

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  return value?.split(";")[0] || "";
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

await request("/api/classes", { expected: 401 });

const signup = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: teacherEmail, password: firstPassword },
  expected: 201,
});
let teacherCookie = cookieFrom(signup.response);
assert.match(teacherCookie, /^ogu_session=/);

const classCreated = await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9, displayName: "검증반" },
  expected: 201,
});
const classId = classCreated.data.class.id;
await request("/api/classes", {
  cookie: teacherCookie,
  method: "POST",
  body: { schoolName, schoolYear: 2099, grade: 5, classNumber: 9 },
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

const verification = await request(`/api/registration/verify?token=${encodeURIComponent(activationToken)}`);
assert.equal(verification.data.student.official_name, "김하늘");
assert.equal(verification.data.student.student_number, 1);

const activated = await request("/api/registration/complete", {
  method: "POST",
  body: { token: activationToken, password: "1357" },
});
let studentCookie = cookieFrom(activated.response);
await request("/api/registration/complete", {
  method: "POST",
  body: { token: activationToken, password: "2468" },
  expected: 410,
});

const me = await request("/api/student/me", { cookie: studentCookie });
assert.equal(me.data.student.id, student.id);

const outsider = await request("/api/teacher/signup", {
  method: "POST",
  body: { email: secondTeacherEmail, password: firstPassword },
  expected: 201,
});
await request(`/api/classes/${classId}/students`, {
  cookie: cookieFrom(outsider.response),
  expected: 404,
});

await request(`/api/students/${student.id}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "locked" },
});
await request("/api/student/me", { cookie: studentCookie, expected: 401 });
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "1357" },
  expected: 401,
});
await request(`/api/students/${student.id}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "active" },
});

const relogin = await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "1357" },
});
studentCookie = cookieFrom(relogin.response);

const resetCard = await request(`/api/students/${student.id}/registration-token`, {
  cookie: teacherCookie,
  method: "POST",
  body: {},
});
await request("/api/student/me", { cookie: studentCookie, expected: 401 });
const resetToken = new URL(resetCard.data.card.activation_url).searchParams.get("token");
await request("/api/registration/complete", {
  method: "POST",
  body: { token: resetToken, password: "2468" },
});
await request("/api/student/login", {
  method: "POST",
  body: { schoolName, grade: 5, classNumber: 9, studentNumber: 1, password: "2468" },
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

console.log("통합 흐름 검증 완료: 교사·학급·학생·일회용 QR·권한·복구");

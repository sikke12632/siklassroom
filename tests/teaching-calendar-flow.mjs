import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const runId = process.env.TEST_RUN_ID || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Teacher!234";
const teacherEmail = `calendar-${runId}@example.test`;
const outsiderEmail = `calendar-outsider-${runId}@example.test`;

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function request(path, {
  cookie = "",
  method = "GET",
  body,
  expected = 200,
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-forwarded-for": `teaching-calendar-${runId}`,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    expectedStatuses.includes(response.status),
    `${method} ${path}: ${response.status} ${JSON.stringify(data)}`,
  );
  return { response, data };
}

async function openTeacher(email) {
  await request("/api/teacher/signup", {
    method: "POST",
    body: { email, password },
    expected: 202,
  });
  const login = await request("/api/teacher/login", {
    method: "POST",
    body: { email, password },
  });
  let cookie = cookieFrom(login.response);
  assert.match(cookie, /^job_classroom_session=/);
  assert.equal(login.data.teacher.teacher_access_status, "invite_verified");

  const schools = await request(
    `/api/schools/search?q=${encodeURIComponent("서울서이초등학교")}`,
    { cookie },
  );
  const school = schools.data.schools.find((item) => item.official_name === "서울서이초등학교");
  assert.ok(school);
  const selected = await request("/api/schools/select", {
    cookie,
    method: "POST",
    body: { schoolId: school.id },
  });
  cookie = cookieFrom(selected.response) || cookie;
  return cookie;
}

const teacherCookie = await openTeacher(teacherEmail);
const outsiderCookie = await openTeacher(outsiderEmail);

let classRoom = null;
for (let attempt = 0; attempt < 12 && !classRoom; attempt += 1) {
  const value = Number(BigInt(Date.now() + attempt) % 12000n);
  const created = await request("/api/classes", {
    cookie: teacherCookie,
    method: "POST",
    body: {
      schoolYear: 2027 + (value % 70),
      grade: 1 + (value % 6),
      classNumber: 1 + (Math.floor(value / 6) % 30),
      displayName: `수업 달력 검증반 ${runId}`,
    },
    expected: [201, 409],
  });
  classRoom = created.response.status === 201 ? created.data.class : null;
}
assert.ok(classRoom, "시간표 통합 테스트 학급을 만들지 못했습니다.");

const classId = classRoom.id;
const teachingPath = `/api/classes/${classId}/teaching-calendar`;
const historicalMonth = `${classRoom.school_year}-03`;
const historicalDraft = await request(
  `/api/classes/${classId}/calendar?month=${historicalMonth}`,
  { cookie: teacherCookie },
);
await request(`/api/classes/${classId}/calendar`, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: historicalDraft.data.calendar.revision,
    schoolYear: classRoom.school_year,
    classStartDate: `${classRoom.school_year}-03-02`,
    firstJobStartDate: `${classRoom.school_year}-03-09`,
    firstJobEndDate: `${classRoom.school_year}-03-27`,
    days: historicalDraft.data.calendar.days.map(({ date, dayType, memo }) => ({
      date,
      dayType,
      memo,
    })),
  },
});

const initial = await request(teachingPath, { cookie: teacherCookie });
assert.equal(initial.data.calendar.monthValue, initial.data.calendar.serverTime.date.slice(0, 7));
assert.notEqual(initial.data.calendar.monthValue, historicalMonth);
assert.equal(initial.data.timetable.saved, false);
assert.equal(initial.data.timetable.revision, 0);

const saved = await request(teachingPath, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: 0,
    periodCount: 7,
    slots: [
      { weekday: 1, period: 1, subject: "국어" },
      { weekday: 1, period: 2, subject: "수학" },
      { weekday: 5, period: 7, subject: "창의적 체험활동" },
    ],
  },
});
assert.equal(saved.data.timetable.revision, 1);
assert.deepEqual(saved.data.timetable.slots, [
  { id: `${classId}:timetable:1:1`, weekday: 1, period: 1, subject: "국어" },
  { id: `${classId}:timetable:1:2`, weekday: 1, period: 2, subject: "수학" },
  { id: `${classId}:timetable:5:7`, weekday: 5, period: 7, subject: "창의적 체험활동" },
]);

const restored = await request(teachingPath, { cookie: teacherCookie });
assert.deepEqual(restored.data.timetable, saved.data.timetable);
const stale = await request(teachingPath, {
  cookie: teacherCookie,
  method: "PUT",
  body: {
    expectedRevision: 0,
    periodCount: 6,
    slots: [{ weekday: 2, period: 1, subject: "과학" }],
  },
  expected: 409,
});
assert.equal(stale.data.code, "TIMETABLE_STALE");
assert.deepEqual((await request(teachingPath, { cookie: teacherCookie })).data.timetable, saved.data.timetable);

await request(teachingPath, { cookie: outsiderCookie, expected: 404 });
await request(teachingPath, {
  cookie: outsiderCookie,
  method: "PUT",
  body: { expectedRevision: 1, periodCount: 6, slots: [] },
  expected: 404,
});

await request(`/api/classes/${classId}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "archived" },
});
const archived = await request(teachingPath, { cookie: teacherCookie });
assert.equal(archived.data.class.status, "archived");
const archivedWrite = await request(teachingPath, {
  cookie: teacherCookie,
  method: "PUT",
  body: { expectedRevision: 1, periodCount: 6, slots: [] },
  expected: 409,
});
assert.equal(archivedWrite.data.code, "CLASS_ARCHIVED");

await request(`/api/classes/${classId}`, {
  cookie: teacherCookie,
  method: "PATCH",
  body: { status: "active" },
});
const reactivated = await request(teachingPath, { cookie: teacherCookie });
assert.equal(reactivated.data.class.status, "active");

console.log(JSON.stringify({
  result: "교사 수업 달력 통합 흐름 통과",
  teacherEmail,
  password,
  classId,
}));

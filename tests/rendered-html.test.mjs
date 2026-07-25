import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("첫 화면은 교사와 학생의 입구를 분명히 보여 준다", async () => {
  const [page, layout, entryIntro] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/EntryIntro.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /<html lang="ko"[^>]*>/);
  assert.match(layout, /default: "직업교실"/);
  assert.match(entryIntro, /우리 반 운영센터/);
  assert.match(entryIntro, /선생님과 학생이 함께 사용하는 우리 반 공간이에요/);
  assert.match(page, /선생님으로 들어가기/);
  assert.match(page, /학생으로 들어가기/);
  assert.doesNotMatch(page, /학급 준비부터|우리 반 직업까지|관리자/);
  assert.doesNotMatch(page + layout, /react-loading-skeleton|Your site is taking shape|codex-preview/);
});

test("서비스의 보안·기록 원칙을 사용자에게 설명한다", async () => {
  const [entryIntro, schema, auth, registration] = await Promise.all([
    readFile(new URL("../app/components/EntryIntro.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/registration/complete/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(entryIntro, /비밀번호는 선생님도 볼 수 없음/);
  assert.match(entryIntro, /학급 준비부터 우리 반 직업까지/);
  assert.match(schema, /classes_identity_uq/);
  assert.match(schema, /students_class_number_uq/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(registration, /used_at IS NULL AND revoked_at IS NULL/);
});

test("관리자 경로와 API는 공용 화면에서 숨기고 서버 세션·CSRF로 보호한다", async () => {
  const [home, adminPage, adminAuth, adminRoute, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ops/[operatorPath]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/system-admin-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/teachers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(home, /admin|관리자|ops/);
  assert.match(adminPage, /index: false/);
  assert.match(adminAuth, /HttpOnly/);
  assert.match(adminAuth, /SameSite=Strict/);
  assert.match(adminAuth, /x-admin-csrf/);
  assert.match(adminRoute, /requireSystemAdmin\(request, \{ csrf: true \}\)/);
  assert.match(schema, /systemAdminSessions/);
  assert.match(schema, /systemAdminAuditLogs/);
});

test("이메일·초대코드·학교 상태를 분리하고 가입 단계를 안내한다", async () => {
  const [portal, schema, migration] = await Promise.all([
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_smooth_thor.sql", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /이메일을 확인해 주세요/);
  assert.match(portal, /초대코드를 입력해 주세요/);
  assert.match(portal, /학교를 선택해 주세요/);
  assert.match(portal, /학교를 찾을 수 없나요\? 직접 입력/);
  assert.match(schema, /emailVerifiedAt/);
  assert.match(schema, /teacherAccessStatus/);
  assert.match(schema, /schools_office_school_uq/);
  assert.match(migration, /teacher_access_after_invite_use/);
});

test("임시 공개 가입은 설정으로 켜고 권한 회수 계정은 우회하지 않는다", async () => {
  const [openRegistration, signup, login, session, portal] = await Promise.all([
    readFile(new URL("../lib/open-registration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(openRegistration, /OPEN_TEACHER_REGISTRATION/);
  assert.match(openRegistration, /teacher_access_status != 'revoked'/);
  assert.match(openRegistration, /teacher_open_registration_activated/);
  assert.match(signup, /openRegistration\s*\?\s*undefined/);
  assert.match(signup, /openRegistration \? "invite_verified" : "pending"/);
  assert.match(login, /activateOpenTeacherRegistration/);
  assert.match(session, /activateOpenTeacherRegistration/);
  assert.match(portal, /mode === "signup" \? "가입하기"/);
  assert.match(portal, /\["계정", "학교", "학급"\]/);
  assert.match(portal, /"3 \/ 3"/);
});

test("서울서이초등학교 검색 시드와 첫 직업 배정 화면을 제공한다", async () => {
  const [database, schema, assignmentPage, assignmentApi] = await Promise.all([
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/job-assignments/InitialJobAssignmentPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-assignments/random/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(database, /서울서이초등학교/);
  assert.match(database, /'B10', '7091394'/);
  assert.match(schema, /studentJobAssignments/);
  assert.match(schema, /student_job_assignments_period_student_uq/);
  assert.match(assignmentPage, /서버 표준시를 서울 시간으로 확인/);
  assert.match(assignmentPage, /희망자 .* 중 1명 뽑기/);
  assert.match(assignmentPage, /선택한 학생 배정·저장/);
  assert.match(assignmentApi, /requireClassManagement/);
  assert.match(assignmentApi, /ownedClass/);
});

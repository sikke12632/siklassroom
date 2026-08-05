import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(child);
    return entry.isFile() && entry.name === "route.ts" ? [child] : [];
  }));
  return files.flat();
}

test("theme controls retain a 44px touch target on compact and mobile layouts", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.theme-toggle button \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.match(styles, /\.theme-toggle-compact button \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.match(styles, /\.header-actions \.theme-toggle button \{ min-width: 44px; \}/);
  assert.doesNotMatch(styles, /\.theme-toggle(?:-compact)? button \{[^}]*min-(?:width|height): (?:3\d|4[0-3])px;/);
});

test("student roster edit inputs identify the student and field to assistive technology", async () => {
  const portal = await readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /aria-label=\{`\$\{student\.official_name\} 학생 번호`\}/);
  assert.match(portal, /aria-label=\{`\$\{student\.official_name\} 학생 이름`\}/);
});

test("student roster controls retain a 44px touch target", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.roster-entry-row input \{ min-height: 44px; \}/);
  assert.match(styles, /\.roster-entry-row button \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.match(styles, /\.table-input \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.table-actions button \{ min-height: 44px;/);
});

test("job setup and assignment controls retain a 44px touch target", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const selector of [
    ".survey-template-list button",
    ".job-remove",
    ".assignment-roster li button",
    ".assignment-toolbar button",
    ".candidate-tools button",
    ".winner-tools button",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(styles, new RegExp(`${escaped} \\{[^}]*min-height: 44px;`), selector);
  }
  assert.match(styles, /\.capacity-control button \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(styles, /\.calendar-summary-strip button, \.assignment-calendar button \{ min-height: 44px;/);
  assert.match(styles, /\.calendar-month > header button \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
});

test("admin filters and job template controls have names and 44px touch targets", async () => {
  const [portal, styles] = await Promise.all([
    readFile(new URL("../app/ops/[operatorPath]/AdminPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /aria-label="교사 이메일 검색"/);
  assert.match(portal, /aria-label="교사 이용 상태 필터"/);
  assert.match(portal, /aria-label=\{`\$\{item\.entered_name\} 요청에 연결할 공식 학교`\}/);
  assert.match(portal, /aria-label=\{`\$\{item\.name\} 기본 직업 활성화`\}/);
  assert.match(portal, /aria-label=\{`\$\{item\.name\} 권장 최소 인원`\}/);
  assert.match(portal, /aria-label=\{`\$\{item\.name\} 권장 최대 인원`\}/);
  assert.match(portal, /aria-label=\{`\$\{item\.name\} 기본 우선순위`\}/);
  assert.match(portal, /aria-label=\{`\$\{item\.name\} 설정 저장`\}/);
  assert.match(styles, /\.admin-account > button \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.admin-table-wrap td > input\[type="number"\] \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.admin-table-wrap td button, \.admin-review-actions button, \.one-time-secret button \{ min-height: 44px;/);
});

test("authentication and finance action controls retain a 44px touch target", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.segmented button \{ min-height: 44px;/);
  assert.match(styles, /\.finance-inline-confirm \.button \{ min-height: 44px;/);
  assert.match(styles, /\.finance-quick-amounts \.button \{\s*min-height: 44px;/);
});

test("QR issuance rechecks active class ownership inside the atomic mutation", async () => {
  const registration = await readFile(new URL("../lib/registration.ts", import.meta.url), "utf8");
  assert.match(registration, /JOIN classes c ON c\.id = s\.class_id/);
  assert.match(registration, /c\.teacher_id = \? AND c\.status = 'active'/);
  assert.match(registration, /isOperationGuardFailure/);
  assert.match(registration, /"QR_ISSUE_STALE"/);
  assert.match(registration, /"QR_RESET_STALE"/);
});

test("session activity timestamps are throttled to avoid a D1 write on every read", async () => {
  const [auth, adminAuth] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/system-admin-auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /SESSION_TOUCH_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(auth, /last_seen_at <= now - SESSION_TOUCH_INTERVAL_MS/);
  assert.match(auth, /WHERE token_hash = \? AND last_seen_at <= \?/);
  assert.match(adminAuth, /ADMIN_SESSION_TOUCH_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(adminAuth, /last_seen_at <= now - ADMIN_SESSION_TOUCH_INTERVAL_MS/);
  assert.match(adminAuth, /WHERE id = \? AND last_seen_at <= \?/);
});

test("header logo and entrance links retain a 44px touch target", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.brand \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.auth-page > header a:not\(\.brand\), \.student-login-page > header a:not\(\.brand\) \{[^}]*min-height: 44px;/);
});

test("failed initial assignment confirmation preserves the local draft", async () => {
  const portal = await readFile(
    new URL("../app/teacher/classes/[classId]/job-assignments/InitialJobAssignmentPortal.tsx", import.meta.url),
    "utf8",
  );
  const complete = portal.slice(
    portal.indexOf("async function completeAssignments()"),
    portal.indexOf("if (!data)", portal.indexOf("async function completeAssignments()")),
  );
  const failure = complete.slice(complete.indexOf("} catch (reason)"));
  assert.match(failure, /배정 초안은 그대로 보관했어요/);
  assert.doesNotMatch(failure, /await load\(\)/);
});

test("QR printing waits until every card image is ready", async () => {
  const printCards = await readFile(new URL("../app/components/PrintCards.tsx", import.meta.url), "utf8");
  assert.match(printCards, /cards\.every\(\(card\) => Boolean\(images\[card\.id\]\)\)/);
  assert.match(printCards, /disabled=\{!printReady\}/);
  assert.match(printCards, /printReady \? "A4 인쇄" : generationError \? "QR 준비 실패" : "QR 준비 중…"/);
});

test("QR print dialog manages keyboard focus and Escape dismissal", async () => {
  const printCards = await readFile(new URL("../app/components/PrintCards.tsx", import.meta.url), "utf8");
  assert.match(printCards, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(printCards, /event\.key === "Escape"/);
  assert.match(printCards, /event\.key !== "Tab"/);
  assert.match(printCards, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(printCards, /previousFocus\?\.isConnected/);
  assert.match(printCards, /type="button" onClick=\{onClose\}/);
});

test("QR print generation reports failures and can retry locally", async () => {
  const printCards = await readFile(new URL("../app/components/PrintCards.tsx", import.meta.url), "utf8");
  assert.match(printCards, /setGenerationError\("QR 이미지를 만들지 못했어요/);
  assert.match(printCards, /\[cards, generationAttempt\]/);
  assert.match(printCards, /role=\{generationError \? "alert" : undefined\}/);
  assert.match(printCards, /function retryGeneration\(\)[\s\S]*setGenerationAttempt\(\(value\) => value \+ 1\)/);
  assert.match(printCards, /onClick=\{retryGeneration\}/);
  assert.match(printCards, /generationError \? "QR 준비 실패"/);
});

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
  assert.match(registration, /registration_operation_guards/);
  assert.match(registration, /credential_revision/);
});

test("Worker는 API 캐시와 외부 프레임을 막는 공통 보안 헤더를 붙인다", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /X-Frame-Options/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /if \(!headers\.has\("Content-Security-Policy"\)\)/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /headers\.set\("Cache-Control", "no-store"\)/);
  assert.match(worker, /securedResponse\(request, await handler\.fetch/);
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

test("관리자 로그인과 로그아웃은 세션과 감사 기록을 함께 저장한다", async () => {
  const [auth, login, session] = await Promise.all([
    readFile(new URL("../lib/system-admin-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/auth/session/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /export async function prepareSystemAdminSession/);
  assert.match(auth, /export async function systemAdminSessionRevocationStatement/);
  assert.match(login, /\.\.\.session\.statements/);
  assert.match(login, /systemAdminAuditStatement\(\{ action: "admin_login_succeeded"/);
  assert.match(session, /systemAdminSessionRevocationStatement/);
  assert.match(session, /database\(\)\.batch/);
  assert.match(session, /systemAdminAuditStatement/);
});

test("인증 요청은 검증 전에 원자적으로 제한하고 가입은 IP 전체 한도를 둔다", async () => {
  const [rateLimit, cryptoSource, teacherLogin, studentLogin, adminLogin, signup, passwordRequest] = await Promise.all([
    readFile(new URL("../lib/rate-limit.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/crypto.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/student/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/password/request/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(rateLimit, /ON CONFLICT\(key\) DO UPDATE/);
  assert.match(rateLimit, /subjectThrottleKey/);
  assert.doesNotMatch(rateLimit, /export async function recordFailure/);
  assert.match(cryptoSource, /verifyPasswordOrDummy/);
  assert.match(cryptoSource, /DUMMY_PASSWORD_HASH/);
  assert.match(teacherLogin, /verifyPasswordOrDummy\(password, teacher\?\.password_hash\)/);
  assert.match(studentLogin, /verifyPasswordOrDummy\(password, student\?\.password_hash\)/);
  assert.match(teacherLogin, /consumeRateLimit\(ipKey/);
  assert.match(adminLogin, /consumeRateLimit\(ipKey/);
  assert.match(signup, /teacher-signup-ip/);
  assert.match(signup, /windowMs: 60 \* 60 \* 1000/);
  assert.match(passwordRequest, /teacher-password-reset-ip/);
  assert.match(passwordRequest, /INSERT INTO teacher_password_resets[\s\S]*SELECT \?, id, \?, \?, \? FROM teachers/);
  assert.match(passwordRequest, /sendTeacherPasswordReset\(email, url\)\.catch/);
  assert.match(passwordRequest, /database\(\)\.batch/);
  assert.match(passwordRequest, /teacher_password_reset_requested/);
  assert.match(passwordRequest, /teacher\?\.id \?\? null/);
});

test("이메일 인증과 비밀번호 재설정 토큰은 서버에 전송되지 않는 URL fragment로 전달한다", async () => {
  const [passwordRequest, teacherPage, resetPage, resetPortal, verification, teacherPortal] = await Promise.all([
    readFile(new URL("../app/api/teacher/password/request/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/reset/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/reset/TeacherReset.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/teacher-verification.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(passwordRequest, /resetUrl\.hash = new URLSearchParams/);
  assert.doesNotMatch(passwordRequest, /reset\?token/);
  assert.match(verification, /url\.hash = new URLSearchParams\(\{ verifyEmailToken/);
  assert.doesNotMatch(verification, /searchParams\.set\("verifyEmailToken"/);
  assert.match(teacherPage, /referrer: "no-referrer"/);
  assert.match(resetPage, /referrer: "no-referrer"/);
  assert.doesNotMatch(resetPage, /searchParams|token=/);
  assert.match(resetPortal, /current\.hash/);
  assert.match(resetPortal, /capturedToken\.current === null/);
  assert.match(resetPortal, /window\.history\.replaceState/);
  assert.ok(
    resetPortal.indexOf("window.history.replaceState") < resetPortal.indexOf("setToken(resetToken)"),
    "재설정 토큰은 화면 상태에 보관하기 전에 주소창에서 지운다",
  );
  assert.match(teacherPortal, /current\.hash/);
  assert.match(teacherPortal, /if \(verificationStarted\.current\) return/);
  assert.match(teacherPortal, /window\.history\.replaceState/);
  assert.match(teacherPortal, /current\.searchParams\.delete\("verifyEmailToken"\)/);
  assert.match(teacherPortal, /이전 인증 링크는 더 이상 사용할 수 없어요/);
  assert.ok(
    teacherPortal.indexOf("window.history.replaceState")
      < teacherPortal.indexOf('postJson("/api/teacher/email-verification/confirm"'),
    "이메일 인증 토큰은 네트워크 요청 전에 주소창에서 지운다",
  );
});

test("본문이 없는 변경 요청도 같은 출처만 허용하고 외부 요청은 제한 횟수를 소모하지 않는다", async () => {
  const [
    responses,
    logout,
    emailRequest,
    individualQr,
    bulkQr,
    assignmentDelete,
    qrVerify,
  ] = await Promise.all([
    readFile(new URL("../lib/responses.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/email-verification/request/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/students/[studentId]/registration-token/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/registration-tokens/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-assignments/[assignmentId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/registration/verify/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(responses, /export function assertSameOriginRequest/);
  assert.match(responses, /assertSameOriginRequest\(request\);/);
  for (const route of [logout, emailRequest, individualQr, bulkQr, assignmentDelete]) {
    assert.match(route, /assertSameOriginRequest\(request\);/);
  }
  assert.ok(
    qrVerify.indexOf("assertSameOriginRequest(request)")
      < qrVerify.indexOf("await consumeRateLimit"),
  );
  const apiRoutes = await routeFiles(fileURLToPath(new URL("../app/api", import.meta.url)));
  for (const routePath of apiRoutes) {
    const source = await readFile(routePath, "utf8");
    if (!/export async function (POST|PUT|PATCH|DELETE)/.test(source)) continue;
    assert.match(
      source,
      /readJson|assertSameOriginRequest|requireSystemAdmin\(request, \{ csrf: true \}\)/,
      `상태 변경 API에 동일 출처 또는 관리자 CSRF 검사가 필요합니다: ${routePath}`,
    );
  }
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
  const [openRegistration, signup, login, session, portal, auth, adminTeachers] = await Promise.all([
    readFile(new URL("../lib/open-registration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/teachers/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(openRegistration, /OPEN_TEACHER_REGISTRATION/);
  assert.match(signup, /INSERT OR IGNORE INTO teachers/);
  assert.match(signup, /openRegistration \? "invite_verified" : "pending"/);
  assert.match(signup, /accepted: true/);
  assert.match(signup, /\}, 202\);/);
  assert.doesNotMatch(signup, /EMAIL_EXISTS|Set-Cookie|createGuardedTeacherSession|issueEmailVerification|developmentVerificationUrl/);
  assert.doesNotMatch(signup, /createSession\(/);
  assert.match(login, /activateOpenRegistration/);
  assert.match(login, /createGuardedTeacherSession/);
  assert.match(login, /accountIssue \|\| !passwordMatches/);
  assert.match(auth, /teacher_access_status != 'revoked'/);
  assert.match(auth, /input\.activateOpenRegistration/);
  assert.match(auth, /DELETE FROM sessions WHERE teacher_id = \?/);
  assert.match(auth, /teacher_open_registration_activated/);
  assert.match(auth, /credential_revision = credential_revision \+ 1/);
  assert.match(adminTeachers, /database\(\)\.batch/);
  assert.match(adminTeachers, /credential_revision = credential_revision \+ 1/);
  assert.match(adminTeachers, /DELETE FROM sessions WHERE teacher_id = \?/);
  assert.doesNotMatch(session, /activateOpenTeacherRegistration/);
  assert.match(session, /reauthenticationRequired: true/);
  assert.match(session, /clearSessionCookie\(request\)/);
  assert.match(portal, /mode === "signup" \? "가입하기"/);
  assert.match(portal, /setMode\("login"\)/);
  assert.match(portal, /requested \? "인증 메일 다시 보내기" : "인증 메일 받기"/);
  assert.match(portal, /\["계정", "학교", "학급"\]/);
  assert.match(portal, /"3 \/ 3"/);
});

test("관리자 교사 권한 변경은 revision과 복구 수단을 원자적으로 처리한다", async () => {
  const [adminTeachers, adminPortal, passwordRequest, passwordReset, adminAudit] = await Promise.all([
    readFile(new URL("../app/api/admin/teachers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ops/[operatorPath]/AdminPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/password/request/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/password/reset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/system-admin-audit.ts", import.meta.url), "utf8"),
  ]);
  assert.match(adminTeachers, /expectedRevision/);
  assert.match(adminTeachers, /slice\(0, 48\)/);
  assert.match(adminTeachers, /typeof body\.expectedRevision !== "number"/);
  assert.match(adminTeachers, /admin_teacher_access/);
  assert.match(adminTeachers, /isOperationGuardFailure/);
  assert.match(adminTeachers, /systemAdminAuditStatement/);
  assert.match(adminTeachers, /UPDATE teacher_password_resets SET used_at/);
  assert.match(adminTeachers, /UPDATE teacher_email_verifications SET invalidated_at/);
  assert.doesNotMatch(adminTeachers, /auditSystemAdmin\(/);
  assert.match(adminAudit, /export function systemAdminAuditStatement/);
  assert.match(passwordRequest, /teacher_access_status != 'revoked'/);
  assert.match(passwordReset, /teacher_access_status != 'revoked'/);
  assert.match(adminPortal, /note === null/);
  assert.match(adminPortal, /actionInFlight/);
  assert.match(adminPortal, /busyTeacherId/);
  assert.match(adminPortal, /expectedRevision/);
  assert.match(adminPortal, /credential_revision/);
});

test("관리자 학교 요청 처리는 상태 변경과 감사 기록을 한 번에 저장한다", async () => {
  const route = await readFile(
    new URL("../app/api/admin/school-requests/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /systemAdminAuditStatement/);
  assert.match(route, /statements\.push\([\s\S]*systemAdminAuditStatement[\s\S]*DELETE FROM registration_operation_guards/);
  assert.doesNotMatch(route, /auditSystemAdmin\(/);
});

test("관리자 기본 직업 변경은 동시 수정과 감사 누락을 막는다", async () => {
  const route = await readFile(
    new URL("../app/api/admin/job-templates/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /admin_job_template_update/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /JOB_TEMPLATE_STALE/);
  assert.match(route, /systemAdminAuditStatement/);
  assert.doesNotMatch(route, /auditSystemAdmin\(/);
});

test("관리자 공지 변경은 동시 수정과 감사 누락을 막는다", async () => {
  const route = await readFile(
    new URL("../app/api/admin/announcement/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /admin_announcement_update/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /ANNOUNCEMENT_STALE/);
  assert.match(route, /systemAdminAuditStatement/);
  assert.doesNotMatch(route, /auditSystemAdmin\(/);
});

test("관리자 초대코드 발급과 폐기는 감사 기록과 함께 저장한다", async () => {
  const [route, verification] = await Promise.all([
    readFile(new URL("../app/api/admin/invite-codes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/teacher-verification.ts", import.meta.url), "utf8"),
  ]);
  assert.match(verification, /export async function prepareInviteCode/);
  assert.match(route, /prepared\.statement/);
  assert.match(route, /admin_invite_code_revoke/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /systemAdminAuditStatement/);
  assert.doesNotMatch(route, /auditSystemAdmin\(/);
});

test("관리자 학교 가져오기는 학교 목록과 감사 기록을 함께 저장한다", async () => {
  const route = await readFile(
    new URL("../app/api/admin/schools/import/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /statements\.push\(systemAdminAuditStatement/);
  assert.match(route, /await database\(\)\.batch\(statements\)/);
  assert.doesNotMatch(route, /auditSystemAdmin\(/);
});

test("교사 권한이 올라갈 때 기존 세션을 폐기하고 요청자 세션만 교체한다", async () => {
  const [auth, verification, emailConfirm, inviteRedeem, schoolSelect, schoolManual] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/teacher-verification.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/email-verification/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/teacher/invite-code/redeem/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/schools/select/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/schools/manual/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /prepareTeacherSessionRotation/);
  assert.match(auth, /teacher_session_rotation/);
  assert.match(auth, /DELETE FROM sessions WHERE teacher_id = \?/);
  assert.match(verification, /teacher_email_verification/);
  assert.match(verification, /rotation\?\.revoke/);
  assert.match(verification, /teacher_invite_code/);
  assert.match(verification, /database\(\)\.batch/);
  for (const route of [emailConfirm, inviteRedeem, schoolSelect, schoolManual]) {
    assert.match(route, /Set-Cookie/);
  }
  for (const route of [schoolSelect, schoolManual]) {
    assert.match(route, /rotation\.guard/);
    assert.match(route, /rotation\.revoke/);
    assert.match(route, /rotation\.create/);
    assert.match(route, /database\(\)\.batch/);
  }
});

test("수동 학교 요청이 거절되면 학교 연결과 기존 교사 세션을 함께 해제한다", async () => {
  const [auth, schoolRequests] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/school-requests/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /school_manual_requests[\s\S]*status = 'pending'/);
  assert.match(schoolRequests, /action === "reject"/);
  assert.match(schoolRequests, /DELETE FROM sessions[\s\S]*manual_school_request_id = \?/);
  assert.match(schoolRequests, /manual_school_request_id = NULL/);
  assert.match(schoolRequests, /credential_revision = credential_revision \+ 1/);
  assert.match(schoolRequests, /admin_school_request_review/);
  assert.match(schoolRequests, /isOperationGuardFailure/);
  assert.match(schoolRequests, /if \(createSchool\) statements\.push\(createSchool\)/);
});

test("서울서이초등학교 검색 시드와 첫 직업 배정 화면을 제공한다", async () => {
  const [database, schema, assignmentPage, calendarPage, winnerPage, assignmentApi, completeApi] = await Promise.all([
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/job-assignments/InitialJobAssignmentPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/job-assignments/CalendarSetup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/job-assignments/WinnerCelebration.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-assignments/random/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-assignments/complete/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(database, /서울서이초등학교/);
  assert.match(database, /'B10', '7091394'/);
  assert.match(schema, /studentJobAssignments/);
  assert.match(schema, /student_job_assignments_period_student_uq/);
  assert.match(schema, /classCalendars/);
  assert.match(schema, /jobAssignmentCandidates/);
  assert.match(calendarPage, /Cloudflare 서버 시각을 대한민국 표준시로 보정/);
  assert.match(calendarPage, /달력 저장하고 직업 배정으로/);
  assert.match(assignmentPage, /모두 선택/);
  assert.match(assignmentPage, /바로 추첨 · 희망자/);
  assert.match(assignmentPage, /로컬 배정 적용/);
  assert.match(assignmentPage, /전체 배정 확정·서버 저장/);
  assert.match(assignmentPage, /window\.localStorage/);
  assert.match(assignmentPage, /chooseSecureCandidate/);
  assert.doesNotMatch(assignmentPage, /job-assignments\/random/);
  assert.doesNotMatch(assignmentPage, /job-assignments\/candidates/);
  assert.match(winnerPage, /결과 바로 보기/);
  assert.match(winnerPage, /당첨!/);
  assert.match(winnerPage, /WINNER_REVEAL_DELAY_MS = 450/);
  assert.doesNotMatch(winnerPage, /3800/);
  assert.match(assignmentPage, /setDrawJob\(selectedJob\.name\)/);
  assert.match(assignmentApi, /requireClassManagement/);
  assert.match(assignmentApi, /ownedActiveClass/);
  assert.match(completeApi, /completeInitialAssignments/);
  assert.match(completeApi, /expectedRevision/);
  assert.match(completeApi, /assignments/);
});

test("동시에 같은 학급을 만드는 요청은 내부 오류 대신 중복으로 거절한다", async () => {
  const route = await readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8");
  assert.match(route, /'class_create'/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /"CLASS_EXISTS"/);
  assert.match(route, /DELETE FROM registration_operation_guards/);
});

test("학급 수정은 빈 요청과 오래된 화면의 덮어쓰기를 막는다", async () => {
  const route = await readFile(new URL("../app/api/classes/[classId]/route.ts", import.meta.url), "utf8");
  assert.match(route, /"CLASS_UPDATE_REQUIRED"/);
  assert.match(route, /'class_update'/);
  assert.match(route, /current\.updated_at = \?/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /"CLASS_STALE"/);
  assert.match(route, /"CLASS_ARCHIVED"/);
});

test("학생 일괄 등록은 보관 학급과 동시 번호 중복을 원자적으로 막는다", async () => {
  const [route, authorization] = await Promise.all([
    readFile(new URL("../app/api/classes/[classId]/students/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/authorization.ts", import.meta.url), "utf8"),
  ]);
  assert.match(authorization, /export async function ownedActiveClass/);
  assert.match(route, /ownedActiveClass/);
  assert.match(route, /'students_bulk_create'/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /"STUDENT_NUMBER_EXISTS"/);
  assert.match(route, /"CLASS_ARCHIVED"/);
});

test("보관된 학급은 조회와 복원 외의 교사 변경 요청을 받지 않는다", async () => {
  const classesDirectory = fileURLToPath(new URL("../app/api/classes", import.meta.url));
  const files = await routeFiles(classesDirectory);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const changesClassData = /export\s+async\s+function\s+(POST|PUT|DELETE)/.test(source);
    const isClassStatusRoute = file.endsWith(path.join("[classId]", "route.ts"));
    if (changesClassData && source.includes("ownedClass(") && !isClassStatusRoute) {
      assert.match(source, /ownedActiveClass/, file);
    }
  }
  const studentMutationFiles = [
    "../app/api/students/[studentId]/route.ts",
    "../app/api/students/[studentId]/registration-token/route.ts",
    "../app/api/students/[studentId]/qr-reset-grant/route.ts",
  ];
  for (const relative of studentMutationFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /ownedActiveStudent/, relative);
  }
});

test("학생 개별 수정은 빈 요청과 오래된 화면의 덮어쓰기를 막는다", async () => {
  const route = await readFile(
    new URL("../app/api/students/[studentId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /"STUDENT_UPDATE_REQUIRED"/);
  assert.match(route, /'student_update'/);
  assert.match(route, /student\.updated_at = \?/);
  assert.match(route, /isOperationGuardFailure/);
  assert.match(route, /"STUDENT_STALE"/);
  assert.match(route, /DELETE FROM registration_operation_guards/);
});

test("학생 명단이 직업 설정보다 먼저 나오고 QR 인쇄는 카드만 출력한다", async () => {
  const [portal, printCards, styles] = await Promise.all([
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PrintCards.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(
    portal.indexOf('data-dashboard-section="students"')
      < portal.indexOf('data-dashboard-section="jobs"'),
  );
  assert.match(portal, /학생 명단 먼저 등록/);
  assert.match(printCards, /document\.body\.classList\.add\("qr-printing"\)/);
  assert.match(styles, /body\.qr-printing \.teacher-shell > :not\(\.print-overlay\)/);
  assert.match(styles, /display: none !important/);
});

test("학생 개인 QR은 식별 카드로 재사용하고 비밀번호 재설정은 10분 허용으로 제한한다", async () => {
  const [registration, complete, verify, individualIssue, printCards, activation, migration] = await Promise.all([
    readFile(new URL("../lib/registration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/registration/complete/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/registration/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/students/[studentId]/registration-token/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PrintCards.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/activate/ActivationPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_thick_justice.sql", import.meta.url), "utf8"),
  ]);
  assert.match(registration, /REGISTRATION_QR_LIFETIME_MS = 400/);
  assert.match(registration, /REGISTRATION_CHALLENGE_LIFETIME_MS = 10/);
  assert.match(registration, /QR_RESET_GRANT_LIFETIME_MS = 10/);
  assert.match(registration, /HttpOnly; SameSite=Strict/);
  assert.match(registration, /registrationActivationUrl/);
  assert.match(complete, /registration_operation_guards/);
  assert.match(complete, /prepareSession/);
  assert.match(verify, /export async function POST/);
  assert.match(verify, /registrationResponseHeaders/);
  assert.match(individualIssue, /purpose: "activate"/);
  assert.doesNotMatch(individualIssue, /purpose.*"reset"/);
  assert.match(printCards, /평소 비밀번호로 로그인/);
  assert.match(activation, /window\.history\.replaceState/);
  assert.doesNotMatch(activation, /registration\/verify\?token/);
  assert.doesNotMatch(activation, /registration\/complete"?, \{ token/);
  assert.match(migration, /registration_challenges/);
  assert.match(migration, /student_qr_reset_grants/);
  assert.match(migration, /credential_revision/);
});

test("보관된 학급은 학생 세션을 끊고 다시 활성화해도 예전 세션을 되살리지 않는다", async () => {
  const [auth, classRoute, sessionRoute, announcements] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/announcements/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /JOIN classes c ON c\.id = s\.class_id/);
  assert.match(auth, /student\.class_status !== "active"/);
  assert.match(classRoute, /database\(\)\.batch\(statements\)/);
  assert.match(classRoute, /status === "archived" \|\| current\.status !== status/);
  assert.match(classRoute, /DELETE FROM sessions/);
  assert.match(classRoute, /SELECT id FROM students WHERE class_id = \?/);
  assert.match(sessionRoute, /c\.status = 'active'/);
  assert.match(announcements, /requireStudent\(request\)/);
});

test("지난달 결과로 다음 달 직업을 한 명씩 고르고 안전하게 확정한다", async () => {
  const [
    schema,
    migration,
    runtimeSchema,
    page,
    portal,
    boardApi,
    closeApi,
    startApi,
    shuffleApi,
    completeApi,
  ] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_flat_human_fly.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/monthly-jobs/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/monthly-jobs/MonthlyJobChoicePortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/monthly-job-choice/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/monthly-job-choice/close/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/monthly-job-choice/start/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/monthly-job-choice/shuffle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/monthly-job-choice/complete/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /classJobMonthClosures/);
  assert.match(schema, /classJobMonthResults/);
  assert.match(schema, /classJobChoiceSessions/);
  for (const source of [migration, runtimeSchema]) {
    assert.match(source, /class_job_month_closures/);
    assert.match(source, /class_job_month_results/);
    assert.match(source, /class_job_choice_sessions/);
  }

  assert.match(page, /MonthlyJobChoicePortal/);
  assert.match(portal, /window\.localStorage/);
  assert.match(portal, /monthly-job-choice\/complete/);
  assert.match(portal, /expectedRevision/);
  assert.match(portal, /expectedJobSetupRevision|jobSetupRevision/);
  assert.match(portal, /현재 차례|currentStudent/);
  assert.match(portal, /다음 학생|nextStudent/);
  assert.match(portal, /남은 자리|remainingCapacity/);
  assert.match(portal, /선택 완료|completedCount|completedStudents/);

  assert.match(boardApi, /requireTeacher|requireClassManagement/);
  assert.match(boardApi, /ownedClass/);
  for (const mutationApi of [closeApi, startApi, shuffleApi, completeApi]) {
    assert.match(mutationApi, /requireClassManagement/);
    assert.match(mutationApi, /ownedActiveClass/);
  }
  assert.match(shuffleApi, /expectedRevision/);
  assert.match(completeApi, /expectedRevision/);
  assert.match(completeApi, /expectedJobSetupRevision/);
});

test("학생 화면은 서울 현재 월이 되기 전의 미래 확정 직업을 미리 보여 주지 않는다", async () => {
  const studentMe = await readFile(new URL("../app/api/student/me/route.ts", import.meta.url), "utf8");
  assert.match(studentMe, /const current = seoulServerTime\(\)/);
  assert.match(studentMe, /p\.assignment_year < \?/);
  assert.match(studentMe, /p\.assignment_month <= \?/);
  assert.match(studentMe, /bind\(studentId, current\.year, current\.year, current\.month\)/);
});

test("학생 직업평가를 안전하게 모아 최종등급과 자동 무작위 순서에 연결한다", async () => {
  const [
    schema,
    migration,
    runtimeSchema,
    service,
    rules,
    studentApi,
    studentPanel,
    teacherPortal,
    monthlyService,
    openApi,
    closeApi,
    finalizeApi,
  ] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_wandering_stephen_strange.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/job-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/job-evaluation-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/student/job-evaluation/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/student/JobEvaluationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/classes/[classId]/monthly-jobs/MonthlyJobChoicePortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/monthly-job-choice.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-evaluation/open/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-evaluation/close/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/job-evaluation/finalize/route.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, migration, runtimeSchema]) {
    assert.match(source, /class_job_evaluation_sessions|classJobEvaluationSessions/);
    assert.match(source, /class_job_evaluation_responses|classJobEvaluationResponses/);
    assert.match(source, /class_job_evaluation_results|classJobEvaluationResults/);
  }
  assert.match(rules, /hardAverage/);
  assert.match(rules, /index < 3/);
  assert.match(rules, /index < 8/);
  assert.match(service, /JOB_EVALUATION_INCOMPLETE/);
  assert.match(service, /finalizedEvaluationGrades/);
  assert.match(studentApi, /requireStudent/);
  assert.match(studentApi, /readJson/);
  assert.match(studentPanel, /힘듦/);
  assert.match(studentPanel, /책임감/);
  assert.match(studentPanel, /꾸준함/);
  assert.match(studentPanel, /개인 부담/);
  assert.match(studentPanel, /localStorage/);
  assert.match(teacherPortal, /학생 직업평가 열기/);
  assert.match(teacherPortal, /같은 등급은 자동 무작위/);
  assert.doesNotMatch(teacherPortal, /기본적으로 번호순/);
  assert.match(monthlyService, /'shuffled'/);
  assert.match(monthlyService, /shuffleChoiceOrderWithinGrades/);
  for (const mutationApi of [openApi, closeApi, finalizeApi]) {
    assert.match(mutationApi, /requireClassManagement/);
    assert.match(mutationApi, /ownedActiveClass/);
    assert.match(mutationApi, /readJson/);
  }
});

test("연속 월 평가 상태와 학생 로컬 초안을 최신 서버 상태에 맞게 복원한다", async () => {
  const [monthlyPortal, teacherPortal, classesApi, studentPanel, css] = await Promise.all([
    readFile(new URL("../app/teacher/classes/[classId]/monthly-jobs/MonthlyJobChoicePortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/student/JobEvaluationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(monthlyPortal, /&& !board\.evaluation/);
  assert.match(monthlyPortal, /job_classroom_job_grade_draft_v1/);
  assert.match(teacherPortal, /monthlyChoiceAccessible/);
  assert.match(teacherPortal, /&& !selectedSummary\.job_evaluation_status/);
  assert.match(classesApi, /evaluation\.source_period_id/);
  assert.match(classesApi, /source\.assignment_month <= clock\.current_month/);
  assert.match(studentPanel, /baseResponseRevision/);
  assert.match(studentPanel, /localScoresAreCurrent/);
  assert.match(studentPanel, /직업평가를 불러오지 못했어요/);
  assert.match(studentPanel, /role="progressbar"/);
  assert.match(studentPanel, /이 점수로 확인하고 다음/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*student-score-options[\s\S]*repeat\(3/);
});

test("여러 학생 QR은 한 번의 원자적 D1 배치로 발급한다", async () => {
  const [registration, bulkQr] = await Promise.all([
    readFile(new URL("../lib/registration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/registration-tokens/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(registration, /export async function issueRegistrationTokens/);
  assert.match(registration, /const statements = issued\.flatMap/);
  assert.match(registration, /await db\.batch\(statements\)/);
  assert.match(registration, /new Set\(input\.studentIds\)\.size/);
  assert.match(bulkQr, /await issueRegistrationTokens/);
  assert.doesNotMatch(bulkQr, /for \(const student[\s\S]*issueRegistrationToken/);
});

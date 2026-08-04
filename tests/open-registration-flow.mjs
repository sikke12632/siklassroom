import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const phase = process.env.OPEN_REGISTRATION_PHASE;
const statePath = process.env.OPEN_REGISTRATION_STATE;
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const password = "Teacher!234";
assert.ok(phase === "setup" || phase === "verify", "OPEN_REGISTRATION_PHASE는 setup 또는 verify여야 합니다.");
assert.ok(statePath, "OPEN_REGISTRATION_STATE 임시 파일 경로가 필요합니다.");

function responseCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function request(runId, pathname, { cookie = "", method = "GET", body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "x-forwarded-for": `open-registration-${runId}`,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${pathname}: ${JSON.stringify(data)}`);
  return { response, data };
}

if (phase === "setup") {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `open-transition-${runId}@example.test`;
  const revokedEmail = `open-revoked-${runId}@example.test`;
  await request(runId, "/api/teacher/signup", {
    method: "POST",
    body: { email, password },
    expected: 202,
  });
  const loginA = await request(runId, "/api/teacher/login", {
    method: "POST",
    body: { email, password },
  });
  const loginB = await request(runId, "/api/teacher/login", {
    method: "POST",
    body: { email, password },
  });
  const cookieA = responseCookie(loginA.response);
  const cookieB = responseCookie(loginB.response);
  assert.notEqual(cookieA, cookieB);
  assert.equal(loginA.data.teacher.email_verified_at, null);
  assert.equal(loginA.data.teacher.teacher_access_status, "pending");

  await request(runId, "/api/teacher/signup", {
    method: "POST",
    body: { email: revokedEmail, password },
    expected: 202,
  });
  const revokedLogin = await request(runId, "/api/teacher/login", {
    method: "POST",
    body: { email: revokedEmail, password },
  });
  const adminUsername = process.env.SYSTEM_ADMIN_USERNAME;
  const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD;
  assert.ok(adminUsername && adminPassword, "관리자 테스트 자격 증명이 필요합니다.");
  const adminLogin = await request(runId, "/api/admin/auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  await request(runId, "/api/admin/teachers", {
    cookie: responseCookie(adminLogin.response),
    method: "PATCH",
    headers: { "x-admin-csrf": adminLogin.data.csrfToken },
    body: { id: revokedLogin.data.teacher.id, action: "revoke", note: "공개가입 전환 테스트" },
  });
  await writeFile(statePath, JSON.stringify({ runId, email, revokedEmail, password, cookieA, cookieB }), {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log("공개가입 전환 검증 준비 완료: pending 다중 세션과 revoked 계정 생성");
} else {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  try {
    const staleSession = await request(state.runId, "/api/session", { cookie: state.cookieA });
    assert.equal(staleSession.data.actor, null);
    assert.equal(staleSession.data.reauthenticationRequired, true);
    assert.match(staleSession.response.headers.get("set-cookie") || "", /Max-Age=0/);

    const concurrentLogins = await Promise.all([
      fetch(`${baseUrl}/api/teacher/login`, {
        method: "POST",
        headers: {
          cookie: state.cookieA,
          "content-type": "application/json",
          "x-forwarded-for": `open-login-a-${state.runId}`,
        },
        body: JSON.stringify({ email: state.email, password: state.password }),
      }),
      fetch(`${baseUrl}/api/teacher/login`, {
        method: "POST",
        headers: {
          cookie: state.cookieB,
          "content-type": "application/json",
          "x-forwarded-for": `open-login-b-${state.runId}`,
        },
        body: JSON.stringify({ email: state.email, password: state.password }),
      }),
    ]);
    const loginStatuses = concurrentLogins.map((response) => response.status).sort();
    assert.ok(
      JSON.stringify(loginStatuses) === JSON.stringify([200, 401])
      || JSON.stringify(loginStatuses) === JSON.stringify([200, 200]),
      `동시 로그인 결과가 예상과 달라요: ${loginStatuses.join(",")}`,
    );
    const winnerCookies = concurrentLogins
      .filter((response) => response.status === 200)
      .map(responseCookie);
    assert.ok(winnerCookies.length >= 1);
    for (const cookie of winnerCookies) assert.match(cookie, /^job_classroom_session=/);
    await request(state.runId, "/api/classes", { cookie: state.cookieA, expected: 401 });
    await request(state.runId, "/api/classes", { cookie: state.cookieB, expected: 401 });
    for (const cookie of winnerCookies) {
      const winnerSession = await request(state.runId, "/api/session", { cookie });
      assert.ok(winnerSession.data.actor.email_verified_at);
      assert.equal(winnerSession.data.actor.teacher_access_status, "invite_verified");
    }

    const retry = await request(state.runId, "/api/teacher/login", {
      method: "POST",
      body: { email: state.email, password: state.password },
    });
    const retryCookie = responseCookie(retry.response);
    for (const cookie of winnerCookies) await request(state.runId, "/api/session", { cookie });
    await request(state.runId, "/api/session", { cookie: retryCookie });
    const approvedLogin = await request(state.runId, "/api/teacher/login", {
      method: "POST",
      body: { email: state.email, password: state.password },
    });
    for (const cookie of winnerCookies) await request(state.runId, "/api/session", { cookie });
    await request(state.runId, "/api/session", { cookie: retryCookie });
    await request(state.runId, "/api/session", { cookie: responseCookie(approvedLogin.response) });

    await request(state.runId, "/api/teacher/login", {
      method: "POST",
      body: { email: state.revokedEmail, password: state.password },
      expected: 401,
    });

    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
    const safeEmail = state.email.replaceAll("'", "''");
    const sql = `SELECT credential_revision, (
      SELECT COUNT(*) FROM audit_logs log
      WHERE log.teacher_id = teacher.id AND log.action = 'teacher_open_registration_activated'
    ) AS activation_count FROM teachers teacher WHERE email = '${safeEmail}'`;
    const queried = spawnSync(process.execPath, [
      wranglerPath, "d1", "execute", "DB", "--local", "--json", "--command", sql,
    ], { cwd: projectRoot, encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(queried.status, 0, `${queried.stdout || ""}\n${queried.stderr || ""}`.slice(-4000));
    const rows = JSON.parse(queried.stdout).at(-1)?.results ?? [];
    assert.equal(Number(rows[0]?.credential_revision), 1);
    assert.equal(Number(rows[0]?.activation_count), 1);
    console.log("공개가입 전환 검증 완료: 재인증·단일 승격·세션 폐기·감사 기록·revoked 차단");
  } finally {
    await rm(statePath, { force: true });
  }
}

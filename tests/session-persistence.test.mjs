import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authUrl = new URL("../lib/auth.ts", import.meta.url);
const sessionRouteUrl = new URL("../app/api/session/route.ts", import.meta.url);

test("normal teacher and student sessions persist for 400 days while reset sessions stay short", async () => {
  const auth = await readFile(authUrl, "utf8");

  assert.match(auth, /NORMAL_SESSION_MS = 400 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(auth, /STUDENT_PASSWORD_RESET_SESSION_MS = 15 \* 60 \* 1000/);
  assert.match(
    auth,
    /actor\.actorType === "student_password_reset"\s*\? STUDENT_PASSWORD_RESET_SESSION_MS\s*:\s*NORMAL_SESSION_MS/,
  );
  assert.match(auth, /Max-Age=\$\{maxAgeSeconds\}/);
});

test("session checks roll only normal sessions and throttle refresh writes", async () => {
  const [auth, route] = await Promise.all([
    readFile(authUrl, "utf8"),
    readFile(sessionRouteUrl, "utf8"),
  ]);

  assert.match(auth, /SESSION_ROLLING_REFRESH_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(auth, /row\.actor_type === "teacher" \|\| row\.actor_type === "student"/);
  assert.match(
    auth,
    /row\.expires_at <= now \+ NORMAL_SESSION_MS - SESSION_ROLLING_REFRESH_INTERVAL_MS/,
  );
  assert.match(auth, /WHERE token_hash = \? AND actor_type = \? AND expires_at = \? AND expires_at > \?/);
  assert.match(route, /getSession\(request, \{ rolling: true \}\)/);
  assert.match(route, /"Set-Cookie": session\.renewalCookie/);
});

test("rolling refresh removes only a small ordered batch of already expired sessions", async () => {
  const auth = await readFile(authUrl, "utf8");

  assert.match(auth, /SESSION_EXPIRED_CLEANUP_LIMIT = 25/);
  assert.match(
    auth,
    /DELETE FROM sessions\s+WHERE id IN \(\s+SELECT id FROM sessions\s+WHERE expires_at <= \?\s+ORDER BY expires_at, id\s+LIMIT \?/,
  );
  assert.doesNotMatch(auth, /DELETE FROM sessions WHERE expires_at <= \?`/);
});

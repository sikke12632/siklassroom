import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-test-loader.mjs", import.meta.url));

const { serializeSystemAdminAuditMetadata } = await import("../lib/system-admin-audit");

test("관리자 감사 메타데이터는 중첩 위치와 대소문자에 관계없이 비밀값을 가린다", () => {
  const serialized = serializeSystemAdminAuditMetadata({
    studentId: "student-safe",
    tokenId: "token-id-safe",
    apiKeyId: "api-key-id-safe",
    secretaryId: "secretary-safe",
    cookiePreference: "essential",
    PASSWORD: "plain-password",
    password_hash: "hashed-password",
    profile: {
      ApiKey: "api-key-value",
      nested: [
        { AUTHORIZATION: "Bearer credential" },
        { Cookie: "session=value" },
        { client_secret: "client-secret-value" },
        { refreshToken: "refresh-token-value" },
      ],
    },
  });

  assert.ok(serialized);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.PASSWORD, "[REDACTED]");
  assert.equal(parsed.password_hash, "[REDACTED]");
  assert.equal(parsed.profile.ApiKey, "[REDACTED]");
  assert.equal(parsed.profile.nested[0].AUTHORIZATION, "[REDACTED]");
  assert.equal(parsed.profile.nested[1].Cookie, "[REDACTED]");
  assert.equal(parsed.profile.nested[2].client_secret, "[REDACTED]");
  assert.equal(parsed.profile.nested[3].refreshToken, "[REDACTED]");
  assert.equal(parsed.studentId, "student-safe");
  assert.equal(parsed.tokenId, "token-id-safe");
  assert.equal(parsed.apiKeyId, "api-key-id-safe");
  assert.equal(parsed.secretaryId, "secretary-safe");
  assert.equal(parsed.cookiePreference, "essential");
  assert.doesNotMatch(serialized, /plain-password|hashed-password|api-key-value|credential|session=value|client-secret-value|refresh-token-value/);
});

test("관리자 감사 로그 런타임 fallback에도 불변 트리거가 포함된다", async () => {
  const source = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  assert.match(source, /CREATE TRIGGER IF NOT EXISTS system_admin_audit_logs_update_guard/);
  assert.match(source, /CREATE TRIGGER IF NOT EXISTS system_admin_audit_logs_delete_guard/);
  assert.match(source, /SYSTEM_ADMIN_AUDIT_LOG_IMMUTABLE/g);
});

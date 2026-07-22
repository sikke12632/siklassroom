import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("첫 화면은 교사와 학생의 입구를 분명히 보여 준다", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /<html lang="ko">/);
  assert.match(layout, /default: "오구학급"/);
  assert.match(page, /학생 계정 준비/);
  assert.match(page, /교사로 시작하기/);
  assert.match(page, /학생 로그인/);
  assert.match(page, /처음 받은 QR/);
  assert.doesNotMatch(page + layout, /react-loading-skeleton|Your site is taking shape|codex-preview/);
});

test("서비스의 보안·기록 원칙을 사용자에게 설명한다", async () => {
  const [page, schema, auth, registration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/registration/complete/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /비밀번호는 선생님도 볼 수 없어요/);
  assert.match(page, /학생마다 변하지 않는 고유 ID/);
  assert.match(page, /공용 기기도 안심/);
  assert.match(schema, /classes_identity_uq/);
  assert.match(schema, /students_class_number_uq/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(registration, /used_at IS NULL AND revoked_at IS NULL/);
});

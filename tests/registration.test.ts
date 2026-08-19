import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isCurrentUnrevokedRegistration,
  REGISTRATION_CHALLENGE_LIFETIME_MS,
  REGISTRATION_QR_PERSISTENT_EXPIRES_AT,
  REGISTRATION_RESET_CHALLENGE_LIFETIME_MS,
} from "../lib/registration-policy";

function registrationRecord(overrides: Partial<{
  expires_at: number;
  revoked_at: number | null;
  generation: number;
  qr_generation: number;
}> = {}) {
  return {
    generation: 4,
    // Old QR records can contain a historical 400-day expiry in the past.
    expires_at: 1,
    revoked_at: null,
    qr_generation: 4,
    ...overrides,
  };
}

test("기존 QR은 과거 만료값이 있어도 현재 세대이고 폐기되지 않았다면 계속 쓴다", () => {
  assert.equal(isCurrentUnrevokedRegistration(registrationRecord()), true);
});

test("교사가 폐기했거나 새 QR로 교체한 카드는 거부한다", () => {
  assert.equal(isCurrentUnrevokedRegistration(registrationRecord({ revoked_at: Date.now() })), false);
  assert.equal(isCurrentUnrevokedRegistration(registrationRecord({ generation: 3, qr_generation: 4 })), false);
});

test("새 QR의 호환용 만료값은 사실상 무기한이며 재설정 확인은 10분을 넘지 않는다", () => {
  assert.ok(REGISTRATION_QR_PERSISTENT_EXPIRES_AT > Date.UTC(9990, 0, 1));
  assert.ok(REGISTRATION_CHALLENGE_LIFETIME_MS > REGISTRATION_RESET_CHALLENGE_LIFETIME_MS);
  assert.equal(REGISTRATION_RESET_CHALLENGE_LIFETIME_MS, 10 * 60 * 1000);
});

test("QR 완료의 원자적 보안 조건도 카드 만료값이 아닌 폐기와 세대를 확인한다", () => {
  const completeRoute = readFileSync(
    new URL("../app/api/registration/complete/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(completeRoute, /rt\.expires_at\s*>/);
  assert.match(completeRoute, /rt\.revoked_at IS NULL/);
  assert.match(completeRoute, /rt\.generation = rc\.qr_generation/);
});

test("QR 진행 쿠키가 사라져도 주소나 저장소에 토큰을 남기지 않고 한 번 복구한다", () => {
  const activationPortal = readFileSync(
    new URL("../app/activate/ActivationPortal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(activationPortal, /qrTokenRef = useRef\(""\)/);
  assert.match(activationPortal, /window\.history\.replaceState/);
  assert.match(activationPortal, /REGISTRATION_CHALLENGE_REQUIRED/);
  assert.match(activationPortal, /REGISTRATION_CHALLENGE_EXPIRED/);
  assert.match(activationPortal, /challengeRefreshAttempted\.current = true/);
  assert.doesNotMatch(activationPortal, /localStorage|sessionStorage/);
  assert.match(activationPortal, /영문 또는 숫자 4~32자/);
});

test("사용 중인 QR을 교체할 때만 기존 학생 세션을 종료한다", () => {
  const registration = readFileSync(
    new URL("../lib/registration.ts", import.meta.url),
    "utf8",
  );
  assert.match(registration, /replacesCurrentQr: Boolean\(student\.has_current_qr\)/);
  assert.match(registration, /item\.replacesCurrentQr[\s\S]*DELETE FROM sessions WHERE student_id = \?/);
});

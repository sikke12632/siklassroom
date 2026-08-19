import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const teacherPortalUrl = new URL("../app/teacher/TeacherPortal.tsx", import.meta.url);
const printCardsUrl = new URL("../app/components/PrintCards.tsx", import.meta.url);

test("교사 로그아웃은 서버 성공 직후 화면의 인증 상태를 비운다", async () => {
  const source = await readFile(teacherPortalUrl, "utf8");
  const logout = source.slice(source.indexOf("async function logout()"), source.indexOf("async function retrySession()"));

  assert.match(logout, /await api\("\/api\/session", \{ method: "DELETE" \}\)/);
  assert.match(logout, /setActor\(null\)/);
  assert.match(logout, /setWrongEntrance\(false\)/);
  assert.match(logout, /setClasses\(\[\]\)/);
  assert.match(logout, /router\.replace\("\/teacher"\)/);
  assert.ok(logout.indexOf("setActor(null)") < logout.indexOf('router.replace("/teacher")'));
});

test("학생 명부 이름 입력은 한글 조합을 보존하며 이름칸끼리 이동한다", async () => {
  const source = await readFile(teacherPortalUrl, "utf8");
  const roster = source.slice(source.indexOf("function RosterEditor("), source.indexOf("function StudentTable("));
  const keyboardHandler = roster.slice(roster.indexOf("function handleRosterKeyDown("), roster.indexOf("function openRangeDialog()"));

  assert.match(keyboardHandler, /event\.nativeEvent\.isComposing/);
  assert.match(keyboardHandler, /event\.key === "ArrowUp"/);
  assert.match(keyboardHandler, /event\.key === "ArrowDown"/);
  assert.match(keyboardHandler, /event\.key === "Tab" && event\.shiftKey/);
  assert.match(keyboardHandler, /event\.key === "Tab" && !event\.shiftKey/);
  assert.match(keyboardHandler, /focusName\(rows\[targetIndex\]\.key\)/);
  assert.match(keyboardHandler, /setRows\(\(current\) => \[\.\.\.current, next\]\)/);
  assert.match(keyboardHandler, /focusName\(next\.key\)/);
  assert.doesNotMatch(keyboardHandler, /data-roster-number/);
  assert.match(roster, /nameInputRefs\.current\.get\(firstBlankName\.key\)\?\.focus\(\)/);
  assert.match(roster, /const nextRows = \[\.\.\.rows, \.\.\.additions\]/);
  assert.match(roster, /if \(firstBlankName\) focusName\(firstBlankName\.key\)/);
  assert.match(roster, /Tab·Enter·위아래 방향키로 이름칸만 연속 이동/);
});

test("학생 QR 카드는 휴대전화 대신 스마트기기 안내를 사용한다", async () => {
  const [source, portal] = await Promise.all([
    readFile(printCardsUrl, "utf8"),
    readFile(teacherPortalUrl, "utf8"),
  ]);

  assert.match(source, /스마트기기로 QR을 찍어요/);
  assert.doesNotMatch(source, /휴대전화로 QR을 찍어요/);
  assert.match(source, /교사가 사용 중지하기 전까지/);
  assert.match(portal, /async function revokeCard/);
  assert.match(portal, /method: "DELETE"/);
  assert.match(portal, /QR 사용 중지/);
  assert.match(portal, /비밀번호 로그인과 현재 로그인은 그대로 유지/);
  assert.match(portal, /QR 사용 중/);
  assert.match(portal, /QR 없음·중지/);
});

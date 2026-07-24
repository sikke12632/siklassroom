import test from "node:test";
import assert from "node:assert/strict";
import { manualSchoolInput, normalizeSchoolSearch, schoolSearchVariants } from "../lib/schools";
import { generateInviteCode, normalizeInviteCode } from "../lib/invite-code";

test("학교 검색어는 공백과 학교급 약칭을 같은 형태로 정규화한다", () => {
  assert.equal(normalizeSchoolSearch(" 서울 서이 초등학교 "), "서울서이초");
  assert.equal(normalizeSchoolSearch("서울서이초"), "서울서이초");
  assert.deepEqual(schoolSearchVariants("서이초등학교"), ["서이초등학교", "서이초"]);
});

test("직접 입력 학교는 별도 요청에 필요한 안전한 값으로 정리한다", () => {
  const input = manualSchoolInput({
    enteredName: "  새봄 초등학교  ",
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "서초구 123",
    note: "신설 학교",
  });
  assert.equal(input.enteredName, "새봄 초등학교");
  assert.equal(input.normalizedName, "새봄초등학교");
  assert.equal(input.provinceName, "서울특별시");
});

test("초대코드는 사람이 읽기 쉬운 20자 일회용 형식이다", () => {
  const code = generateInviteCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}$/);
  assert.equal(normalizeInviteCode(code).length, 20);
  assert.equal(normalizeInviteCode(code.toLowerCase().replaceAll("-", " ")), normalizeInviteCode(code));
});

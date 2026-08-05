import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeNewStudentPassword,
  isValidExistingStudentPassword,
} from "../lib/student-password";

test("기존 학생의 4자리 비밀번호 로그인 호환성을 보존한다", () => {
  assert.equal(isValidExistingStudentPassword("2468"), true);
  assert.equal(isValidExistingStudentPassword("123"), false);
  assert.equal(isValidExistingStudentPassword("12ab"), false);
});

test("새 학생 비밀번호는 6자리 이상이며 반복·연속 숫자를 거절한다", () => {
  for (const password of ["258025", "908172", "13579024"]) {
    assert.equal(isSafeNewStudentPassword(password), true, password);
  }
  for (const password of ["2468", "111111", "123456", "654321", "1234567890123", "12345a"]) {
    assert.equal(isSafeNewStudentPassword(password), false, password);
  }
});

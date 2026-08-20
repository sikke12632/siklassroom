import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeNewStudentPassword,
  isValidExistingStudentPassword,
} from "../lib/student-password";

test("기존 숫자 비밀번호와 새 영문 비밀번호 로그인을 함께 허용한다", () => {
  for (const password of ["2468", "1111", "123456", "apple", "abc123"]) {
    assert.equal(isValidExistingStudentPassword(password), true, password);
  }
  for (const password of ["123", "비밀번호", "abc!123", "a".repeat(33)]) {
    assert.equal(isValidExistingStudentPassword(password), false, password);
  }
});

test("새 학생 비밀번호는 영문·숫자 4~32자만 최소 제한한다", () => {
  for (const password of ["1111", "1234", "123456", "apple", "abc123", "a".repeat(32)]) {
    assert.equal(isSafeNewStudentPassword(password), true, password);
  }
  for (const password of ["123", "abc def", "abc!123", "비밀번호", "a".repeat(33)]) {
    assert.equal(isSafeNewStudentPassword(password), false, password);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STUDENT_SCHOOL_CODE,
  normalizeStudentSchoolCode,
} from "../lib/student-login-rules";

test("학생 학교코드는 앞의 0을 유지하고 숫자 코드만 허용한다", () => {
  assert.equal(DEFAULT_STUDENT_SCHOOL_CODE, "01");
  assert.equal(normalizeStudentSchoolCode("01"), "01");
  assert.equal(normalizeStudentSchoolCode(" ０１ "), "01");
  assert.equal(normalizeStudentSchoolCode(1), "");
  assert.equal(normalizeStudentSchoolCode("학교01"), "");
  assert.equal(normalizeStudentSchoolCode("1"), "");
  assert.equal(normalizeStudentSchoolCode("1234567"), "");
});

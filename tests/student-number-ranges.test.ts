import test from "node:test";
import assert from "node:assert/strict";
import { parseStudentNumberRanges } from "../lib/student-number-ranges";

test("학생 번호 범위와 낱개 번호를 함께 펼친다", () => {
  const result = parseStudentNumberRanges("1~3 8, 10~12");

  assert.deepEqual(result, {
    ok: true,
    numbers: [1, 2, 3, 8, 10, 11, 12],
  });
});

test("요청한 두 번호 범위에서 학생 행 26개를 준비한다", () => {
  const result = parseStudentNumberRanges("1~13 51~63", { maxCount: 60 });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.numbers.length, 26);
    assert.deepEqual(result.numbers.slice(0, 3), [1, 2, 3]);
    assert.deepEqual(result.numbers.slice(-3), [61, 62, 63]);
  }
});

test("쉼표와 공백을 구분자로 사용하고 중복을 제거해 오름차순으로 반환한다", () => {
  const result = parseStudentNumberRanges("  9, 3~5\n4  1，9  ");

  assert.deepEqual(result, {
    ok: true,
    numbers: [1, 3, 4, 5, 9],
  });
});

test("물결표 주변 공백과 전각 물결표도 입력할 수 있다", () => {
  assert.deepEqual(parseStudentNumberRanges("1 ~ 3, 5～6 8〜9"), {
    ok: true,
    numbers: [1, 2, 3, 5, 6, 8, 9],
  });
});

test("빈 입력과 잘못된 표기를 구분해 알린다", () => {
  const empty = parseStudentNumberRanges("  ,  ");
  const malformed = parseStudentNumberRanges("1-3");

  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error.code, "EMPTY_INPUT");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.error.code, "INVALID_FORMAT");
    assert.equal(malformed.error.token, "1-3");
  }
});

test("학생 번호가 1~99 범위를 벗어나면 거절한다", () => {
  for (const input of ["0", "99~100", "999999999999999999999"]) {
    const result = parseStudentNumberRanges(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "OUT_OF_BOUNDS");
  }
});

test("큰 번호에서 작은 번호로 된 범위는 거절한다", () => {
  const result = parseStudentNumberRanges("13~1");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DESCENDING_RANGE");
    assert.equal(result.error.token, "13~1");
  }
});

test("화면이 지정한 한 번의 최대 추가 인원 수를 중복 제거 후 검사한다", () => {
  assert.deepEqual(parseStudentNumberRanges("1~3 2~4", { maxCount: 4 }), {
    ok: true,
    numbers: [1, 2, 3, 4],
  });

  const result = parseStudentNumberRanges("1~5", { maxCount: 4 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "TOO_MANY_NUMBERS");
});

test("학생 행 일괄 추가는 한 번에 60개까지만 허용한다", () => {
  const sixty = parseStudentNumberRanges("1~60", { maxCount: 60 });
  const sixtyOne = parseStudentNumberRanges("1~61", { maxCount: 60 });

  assert.equal(sixty.ok, true);
  if (sixty.ok) assert.equal(sixty.numbers.length, 60);
  assert.equal(sixtyOne.ok, false);
  if (!sixtyOne.ok) assert.equal(sixtyOne.error.code, "TOO_MANY_NUMBERS");
});

test("필요한 화면에서는 번호 범위를 별도로 제한할 수 있다", () => {
  assert.deepEqual(parseStudentNumberRanges("51~53", { min: 50, max: 60 }), {
    ok: true,
    numbers: [51, 52, 53],
  });

  const result = parseStudentNumberRanges("49", { min: 50, max: 60 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "OUT_OF_BOUNDS");
});

test("잘못된 파서 옵션은 프로그래밍 오류로 처리한다", () => {
  assert.throws(() => parseStudentNumberRanges("1", { min: 99, max: 1 }), RangeError);
  assert.throws(() => parseStudentNumberRanges("1", { maxCount: 0 }), RangeError);
});

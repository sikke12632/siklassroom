export const MIN_STUDENT_NUMBER = 1;
export const MAX_STUDENT_NUMBER = 99;

export type StudentNumberRangeErrorCode =
  | "EMPTY_INPUT"
  | "INVALID_FORMAT"
  | "OUT_OF_BOUNDS"
  | "DESCENDING_RANGE"
  | "TOO_MANY_NUMBERS";

export type StudentNumberRangeError = {
  code: StudentNumberRangeErrorCode;
  message: string;
  token?: string;
};

export type StudentNumberRangeResult =
  | { ok: true; numbers: number[] }
  | { ok: false; numbers: []; error: StudentNumberRangeError };

export type StudentNumberRangeOptions = {
  min?: number;
  max?: number;
  maxCount?: number;
};

function failure(error: StudentNumberRangeError): StudentNumberRangeResult {
  return { ok: false, numbers: [], error };
}

function inBounds(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/**
 * Parses student-number input such as `1~13 51~63` or `1, 3, 5~8`.
 * Whitespace and commas are separators. Overlapping values are de-duplicated,
 * and successful results are always returned in ascending order.
 */
export function parseStudentNumberRanges(
  input: string,
  options: StudentNumberRangeOptions = {},
): StudentNumberRangeResult {
  const min = options.min ?? MIN_STUDENT_NUMBER;
  const max = options.max ?? MAX_STUDENT_NUMBER;
  const maxCount = options.maxCount;

  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError("학생 번호 최솟값과 최댓값을 다시 확인해 주세요.");
  }
  if (maxCount !== undefined && (!Number.isSafeInteger(maxCount) || maxCount < 1)) {
    throw new RangeError("학생 수 제한은 1 이상의 정수여야 합니다.");
  }

  const normalized = input.trim().replace(/\s*[~～〜]\s*/g, "~");
  if (!normalized) {
    return failure({
      code: "EMPTY_INPUT",
      message: "추가할 학생 번호를 입력해 주세요.",
    });
  }

  const tokens = normalized.split(/[\s,，]+/).filter(Boolean);
  if (!tokens.length) {
    return failure({
      code: "EMPTY_INPUT",
      message: "추가할 학생 번호를 입력해 주세요.",
    });
  }
  const numbers = new Set<number>();

  for (const token of tokens) {
    const singleMatch = /^(\d+)$/.exec(token);
    const rangeMatch = /^(\d+)~(\d+)$/.exec(token);

    if (!singleMatch && !rangeMatch) {
      return failure({
        code: "INVALID_FORMAT",
        message: `“${token}”을 확인해 주세요. 번호는 1 또는 1~13처럼 입력할 수 있어요.`,
        token,
      });
    }

    const start = Number(singleMatch?.[1] ?? rangeMatch?.[1]);
    const end = Number(singleMatch?.[1] ?? rangeMatch?.[2]);

    if (!inBounds(start, min, max) || !inBounds(end, min, max)) {
      return failure({
        code: "OUT_OF_BOUNDS",
        message: `“${token}”을 확인해 주세요. 학생 번호는 ${min}~${max} 사이여야 해요.`,
        token,
      });
    }

    if (start > end) {
      return failure({
        code: "DESCENDING_RANGE",
        message: `“${token}”의 시작 번호가 끝 번호보다 큽니다. 작은 번호부터 입력해 주세요.`,
        token,
      });
    }

    for (let studentNumber = start; studentNumber <= end; studentNumber += 1) {
      numbers.add(studentNumber);
      if (maxCount !== undefined && numbers.size > maxCount) {
        return failure({
          code: "TOO_MANY_NUMBERS",
          message: `한 번에 ${maxCount}명까지 추가할 수 있어요. 입력 범위를 줄여 주세요.`,
          token,
        });
      }
    }
  }

  return { ok: true, numbers: [...numbers].sort((left, right) => left - right) };
}

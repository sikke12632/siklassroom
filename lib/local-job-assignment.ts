const UINT32_RANGE = 0x1_0000_0000;

export function secureRandomIndex(
  length: number,
  fillRandom: (values: Uint32Array) => Uint32Array = (values) => crypto.getRandomValues(values),
) {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error("추첨 후보가 한 명 이상 필요합니다.");
  }
  const unbiasedLimit = Math.floor(UINT32_RANGE / length) * length;
  const values = new Uint32Array(1);
  do {
    fillRandom(values);
  } while (values[0] >= unbiasedLimit);
  return values[0] % length;
}

export function chooseSecureCandidate<T>(
  candidates: readonly T[],
  fillRandom?: (values: Uint32Array) => Uint32Array,
) {
  return candidates[secureRandomIndex(candidates.length, fillRandom)];
}

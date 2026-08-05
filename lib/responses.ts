export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  console.error(error);
  return json({ error: "잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.", code: "INTERNAL_ERROR" }, 500);
}

export const MAX_JSON_BODY_BYTES = 64 * 1024;

const INVALID_JSON_MESSAGE = "입력 내용을 다시 확인해 주세요.";

function invalidJson() {
  return new ApiError(400, INVALID_JSON_MESSAGE, "INVALID_JSON");
}

function jsonBodyTooLarge() {
  return new ApiError(413, "요청 내용은 64KB 이하여야 해요.", "REQUEST_BODY_TOO_LARGE");
}

function assertJsonContentType(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const structuredJson = mediaType
    ? /^application\/[a-z0-9!#$%&'*.^_`|~-]+\+json$/.test(mediaType)
    : false;
  if (mediaType !== "application/json" && !structuredJson) {
    throw new ApiError(415, "JSON 형식의 요청만 보낼 수 있어요.", "UNSUPPORTED_MEDIA_TYPE");
  }
}

function assertDeclaredBodySize(request: Request) {
  const rawLength = request.headers.get("content-length")?.trim();
  if (!rawLength || !/^\d+$/.test(rawLength)) return;
  const declaredLength = Number(rawLength);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_JSON_BODY_BYTES) {
    throw jsonBodyTooLarge();
  }
}

async function readBoundedBody(request: Request) {
  if (!request.body) throw invalidJson();
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_JSON_BODY_BYTES);
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (byteLength + value.byteLength > MAX_JSON_BODY_BYTES) {
        await reader.cancel("JSON request body exceeded the size limit").catch(() => undefined);
        throw jsonBodyTooLarge();
      }
      bytes.set(value, byteLength);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return bytes.subarray(0, byteLength);
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const targetOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== targetOrigin) || (fetchSite && fetchSite === "cross-site")) {
    throw new ApiError(403, "허용되지 않은 요청입니다.", "CROSS_SITE_REQUEST_BLOCKED");
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  assertSameOriginRequest(request);
  if (!request.body) throw invalidJson();
  assertJsonContentType(request);
  assertDeclaredBodySize(request);
  try {
    const body = await readBoundedBody(request);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidJson();
  }
}

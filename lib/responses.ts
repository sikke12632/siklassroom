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

export async function readJson<T>(request: Request): Promise<T> {
  const origin = request.headers.get("origin");
  const targetOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== targetOrigin) || (fetchSite && fetchSite === "cross-site")) {
    throw new ApiError(403, "허용되지 않은 요청입니다.", "CROSS_SITE_REQUEST_BLOCKED");
  }
  try {
    return await request.json() as T;
  } catch {
    throw new ApiError(400, "입력 내용을 다시 확인해 주세요.", "INVALID_JSON");
  }
}

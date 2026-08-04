export type ApiResult<T> = T & { error?: string; code?: string };

export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({ error: "응답을 읽을 수 없습니다." })) as ApiResult<T>;
  if (!response.ok) {
    throw new ClientApiError(
      data.error || "잠시 문제가 생겼어요. 다시 시도해 주세요.",
      response.status,
      data.code,
    );
  }
  return data;
}

export function postJson<T>(url: string, body: unknown) {
  return api<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export function patchJson<T>(url: string, body: unknown) {
  return api<T>(url, { method: "PATCH", body: JSON.stringify(body) });
}

export function putJson<T>(url: string, body: unknown) {
  return api<T>(url, { method: "PUT", body: JSON.stringify(body) });
}

export function friendlyStatus(status: string) {
  return ({
    pending: "등록 전",
    active: "사용 중",
    reset_required: "새 비밀번호 필요",
    locked: "잠김",
    excluded: "학급에서 제외",
  } as Record<string, string>)[status] || status;
}

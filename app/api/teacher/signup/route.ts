import { createSession } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
import { hashPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) throw new ApiError(400, "사용할 이메일을 정확히 입력해 주세요.", "INVALID_EMAIL");
    if (password.length < 8 || password.length > 72) throw new ApiError(400, "비밀번호는 8~72자로 만들어 주세요.", "WEAK_PASSWORD");
    await ensureSchema();
    const existing = await database().prepare(`SELECT id FROM teachers WHERE email = ?`).bind(email).first();
    if (existing) throw new ApiError(409, "이미 가입한 이메일이에요. 로그인하거나 비밀번호를 다시 설정해 주세요.", "EMAIL_EXISTS");
    const id = crypto.randomUUID();
    const now = Date.now();
    await database().prepare(
      `INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`,
    ).bind(id, email, await hashPassword(password), now, now).run();
    await audit({ action: "teacher_signup", teacherId: id });
    const session = await createSession({ actorType: "teacher", teacherId: id }, request);
    return json({ teacher: { id, email } }, 201, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}

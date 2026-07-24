import { runtimeEnv } from "./database";

export async function sendTeacherPasswordReset(email: string, resetUrl: string) {
  const { RESEND_API_KEY, MAIL_FROM } = runtimeEnv();
  if (!RESEND_API_KEY || !MAIL_FROM) return { sent: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [email],
      subject: "직업교실 비밀번호 다시 설정하기",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#243047"><h2>비밀번호를 다시 설정해 주세요</h2><p>아래 버튼은 30분 동안 한 번만 사용할 수 있습니다.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#216869;color:white;border-radius:10px;text-decoration:none;font-weight:700">새 비밀번호 설정</a></p><p>요청한 적이 없다면 이 메일을 무시해 주세요.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Password reset email failed: ${response.status}`);
  return { sent: true };
}

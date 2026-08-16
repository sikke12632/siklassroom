import { runtimeEnv } from "./database";

async function sendEmail(input: { to: string; subject: string; html: string }) {
  const { RESEND_API_KEY, MAIL_FROM } = runtimeEnv();
  if (!RESEND_API_KEY || !MAIL_FROM) return { sent: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!response.ok) throw new Error(`Email delivery failed: ${response.status}`);
  return { sent: true };
}

export async function sendTeacherPasswordReset(email: string, resetUrl: string) {
  return sendEmail({
    to: email,
    subject: "우리반운영센터 비밀번호 다시 설정하기",
    html: `<div style="font-family:'Noto Sans KR',Arial,sans-serif;line-height:1.7;color:#243047"><h2>비밀번호를 다시 설정해 주세요</h2><p>아래 버튼은 30분 동안 한 번만 사용할 수 있습니다.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#ef755f;color:white;border-radius:10px;text-decoration:none;font-weight:700">새 비밀번호 설정</a></p><p>요청한 적이 없다면 이 메일을 무시해 주세요.</p></div>`,
  });
}

export async function sendTeacherEmailVerification(email: string, verificationUrl: string) {
  return sendEmail({
    to: email,
    subject: "우리반운영센터 이메일을 확인해 주세요",
    html: `<div style="font-family:'Noto Sans KR',Arial,sans-serif;line-height:1.7;color:#243047"><h2>이메일을 확인해 주세요</h2><p>우리반운영센터 가입을 계속하려면 아래 버튼을 눌러 주세요. 이 링크는 15분 동안 한 번만 사용할 수 있습니다.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:12px 20px;background:#ef755f;color:white;border-radius:10px;text-decoration:none;font-weight:700">이메일 확인하기</a></p><p>가입한 적이 없다면 이 메일을 무시해 주세요.</p></div>`,
  });
}

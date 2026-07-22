import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "오구학급", template: "%s | 오구학급" },
  description: "선생님은 쉽게, 학생들은 재밌게. 안전한 학급 계정과 학생 등록의 시작.",
  openGraph: {
    title: "오구학급",
    description: "학급과 학생 계정을 만들고, 일회용 QR로 안전하게 시작하세요.",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og-classroom.png", width: 1731, height: 909, alt: "교사와 학생이 등록 QR 카드로 학급 계정을 준비하는 모습" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "오구학급",
    description: "학급과 학생 계정을 만들고, 일회용 QR로 안전하게 시작하세요.",
    images: ["/og-classroom.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

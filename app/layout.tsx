import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "우리반운영센터", template: "%s | 우리반운영센터" },
  description: "학생 관리, 일정, 직업, 금융과 마트를 한곳에서 연결하는 통합 학급 운영 시스템.",
  openGraph: {
    title: "우리반운영센터",
    description: "선생님과 학생이 함께 사용하는 우리 반 통합 운영 공간.",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "우리반운영센터 학급 운영 대시보드" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "우리반운영센터",
    description: "선생님과 학생이 함께 사용하는 우리 반 통합 운영 공간.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="job_classroom_theme_v1",s=localStorage.getItem(k),t=s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

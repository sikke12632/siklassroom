import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "직업교실", template: "%s | 직업교실" },
  description: "학급과 학생 계정을 준비하고 우리 반 직업을 추천·편집하는 통합 학급 운영 시스템.",
  openGraph: {
    title: "직업교실",
    description: "학급과 학생 계정을 만들고 우리 반 직업을 준비하세요.",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "직업교실 학급 운영 대시보드" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "직업교실",
    description: "학급과 학생 계정을 만들고 우리 반 직업을 준비하세요.",
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

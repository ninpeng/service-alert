import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "서비스 알림",
  description: "내부 플랫폼 서비스 상태 알림"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

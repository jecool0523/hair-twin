import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hair Twin — 살롱 헤어 상담",
  description:
    "미용실에서 미용사와 고객이 함께 사용하는 헤어 상담 도구. 얼굴은 유지하고 헤어만 통제된 방식으로 미리보기.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6d5ef0",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import "tldraw/tldraw.css";
import "./canvas.css";

export const metadata: Metadata = {
  title: "AI Tutor · CSS 可视化教学画布",
  description: "通过独立渲染、可视化对比和实时教学理解 CSS。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

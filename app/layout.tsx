import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-orbitron",
});

export const metadata: Metadata = {
  title: "Cyber GPU Cluster",
  description: "Farm $HASH, mine TON, build your GPU cluster.",
};

// Забороняємо мобільний зум (pinch/double-tap) — Telegram Mini App має
// поводитись як нативний застосунок, а не як веб-сторінка.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Мінімальний кореневий layout: html/body/шрифти/метадані — спільні для і
// Telegram Mini App (app/(app)/**), і адмінки (app/admin/**). Telegram-специфічні
// провайдери/чрозм (Header, BottomNav, TonConnect, UserData) — лише в
// app/(app)/layout.tsx, адмінці вони не потрібні й лише заважали б.
//
// <Script beforeInteractive> має бути саме в кореневому layout — Next.js
// не дозволяє цю стратегію у вкладених layout'ах.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: Telegram WebApp SDK вставляє інлайн-стилі
    // (--tg-viewport-height тощо) у <html> ще до монтування React, тому
    // серверний і клієнтський рендер тега <html> розходяться — це очікувано
    // і безпечно ігнорувати (сам SDK, а не наш код, модифікує DOM).
    <html
      lang="uk"
      className={`${inter.variable} ${orbitron.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-white antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}

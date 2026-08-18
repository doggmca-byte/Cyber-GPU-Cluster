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
        {/*
          Monetag SDK (zone 11600101) — реєструє window.show_11600101, який
          дергають lib/ads/monetag.ts (showRewardedAd) з DailyBonusModal та
          WatchAdButton. strategy="afterInteractive": next/script сам
          відповідає за коректну вставку/гідратацію тега незалежно від його
          літерального місця в JSX-дереві, тому додаткового <head> тут не
          потрібно — це і рятує від SSR/CSR-розбіжностей гідратації.
        */}
        <Script data-sdk="show_11600101" data-zone="11600101" src="//libtl.com/sdk.js" strategy="afterInteractive" />
        {/*
          GigaPub SDK (App ID 7784) — реєструє window.showGiga, який дергає
          lib/ads/gigapub.ts (showGigaRewardedAd). Другий rewarded-провайдер
          поряд із Monetag SDK вище — DailyBonusModal/WatchAdButton показують
          обидва послідовно перед клеймом/нарахуванням.
        */}
        <Script src="https://ad.gigapub.tech/script?id=7784" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}

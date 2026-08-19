import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { TelegramInit } from "@/components/TelegramInit";
import { IntroLoader } from "@/components/IntroLoader";
import { UserDataProvider } from "@/components/providers/UserDataProvider";
import { TonConnectProvider } from "@/components/providers/TonConnectProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";

// Чрозм Telegram Mini App: мова, ready()/expand(), TON Connect, спільний стан
// користувача, Header + BottomNav. Обгортає лише 5 ігрових екранів — не /admin.
// LanguageProvider — найзовнішній, бо TonConnectProvider читає з нього мову
// для локалізації власної модалки гаманця.
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <LanguageProvider>
      <TelegramInit />

      <TonConnectProvider>
        <UserDataProvider>
          {/* IntroLoader — поверх усього як fixed overlay, поки триває
              Telegram SDK init + перший /api/user/sync. Реальний чрозм
              (Header/main/BottomNav) монтується одразу під ним, а не після
              зникнення спланша — жодного layout shift/flicker при фейді. */}
          <IntroLoader />

          <div className="relative mx-auto flex min-h-dvh max-w-lg flex-col">
            <Header />
            <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4">{children}</main>
            <BottomNav />
          </div>
        </UserDataProvider>
      </TonConnectProvider>
    </LanguageProvider>
  );
}

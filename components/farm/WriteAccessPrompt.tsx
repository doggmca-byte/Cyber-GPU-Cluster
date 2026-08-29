"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

const DISMISSED_KEY = "cyber-gpu-cluster:write-access-dismissed";

/**
 * Банер "Дозволь боту писати тобі" — показує нативний Telegram-діалог
 * requestWriteAccess() (types/telegram-web-app.d.ts) ПРЯМО із застосунку,
 * без потреби йти в чат бота й тиснути /start. Актуально: живий аудит
 * розсилки показав, що ~83% профілів мають "chat not found" (ніколи не
 * відкривали чат з ботом) — саме ця дія це виправляє.
 *
 * Джерело правди про поточний стан — сам Telegram
 * (initDataUnsafe.user.allows_write_to_pm), не наш бекенд: якщо юзер уже
 * дозволив (з будь-якого попереднього виклику чи діалогу після /start),
 * банер не рендериться взагалі. Якщо юзер натиснув "Не зараз" АБО
 * "Скасувати" в самому нативному діалозі — більше не набридаємо цього
 * пристрою (localStorage, не критично, якщо скинеться при очищенні кешу).
 */
export function WriteAccessPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.requestWriteAccess) return; // старий клієнт Telegram — метод недоступний

    const alreadyAllowed = webApp.initDataUnsafe?.user?.allows_write_to_pm;
    if (alreadyAllowed) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // localStorage недоступний (приватний режим тощо) — просто не персистимо відмову.
    }
    if (dismissed) return;

    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // не критично — просто побачить банер ще раз наступного разу.
    }
  };

  const allow = () => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.requestWriteAccess) {
      dismiss();
      return;
    }
    // Незалежно від granted true/false — це вже усвідомлений вибір юзера
    // (сам нативний діалог мав "Скасувати"/"Дозволити"), більше не питаємо.
    webApp.requestWriteAccess(() => dismiss());
  };

  if (!visible) return null;

  return (
    <div className="glass-card relative flex items-center gap-3 border-neon-cyan/25 p-3.5 shadow-[0_0_1px_rgba(34,211,238,0.7),0_0_20px_rgba(34,211,238,0.15)]">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.writeAccess.laterButton}
        className="absolute right-2.5 top-2.5 rounded-full p-1 text-slate-600 transition hover:bg-white/5 hover:text-slate-300"
      >
        <X size={13} />
      </button>

      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan">
        <BellRing size={18} />
      </div>

      <div className="min-w-0 flex-1 pr-5">
        <p className="text-xs font-semibold text-white">{t.writeAccess.title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{t.writeAccess.description}</p>

        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={allow}
            className="rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-500 px-3 py-1.5 text-[11px] font-bold text-background shadow-[0_0_12px_rgba(52,211,153,0.35)] transition active:scale-95"
          >
            {t.writeAccess.allowButton}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:text-slate-300"
          >
            {t.writeAccess.laterButton}
          </button>
        </div>
      </div>
    </div>
  );
}

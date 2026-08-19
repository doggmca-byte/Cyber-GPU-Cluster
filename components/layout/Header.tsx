"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hexagon, Gem, ShieldCheck, Plus } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { LanguageSelector } from "./LanguageSelector";
import { SupportButton } from "./SupportButton";

export function Header() {
  const pathname = usePathname();
  const { state } = useUserData();
  const { language, t } = useTranslation();

  // /tasks малює власну верхню плашку (заголовок "ЦЕНТР ЗАВДАНЬ" + кнопка
  // закриття) — спільний Header тут не рендеримо, щоб він не дублювався і не
  // перекривав її (та не заходив під статус-бар Telegram двома шапками одразу).
  if (pathname === "/tasks") return null;

  // Header монтується один раз для всіх табів (у layout), тому не блокує
  // рендер сторінки на loading/error — просто показує 0, доки немає даних.
  const profile = state.status === "ready" ? state.data.profile : null;
  const hashBalance = profile?.hash_balance ?? 0;
  const tonBalance = (profile?.game_balance ?? 0) + (profile?.withdrawable_balance ?? 0);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-white/5 bg-background/95 px-4 py-2.5">
      {/* Самодостатній компонент — сам володіє isOpen, закритий за замовчуванням. */}
      <LanguageSelector />

      <div className="flex items-center gap-1.5">
        <div className="glass-card flex items-center gap-1.5 border-neon-green/30 px-2.5 py-1.5 shadow-neon-green">
          <Hexagon size={13} className="text-neon-green" fill="currentColor" fillOpacity={0.2} />
          <span className="text-xs font-semibold tabular-nums text-white">
            {formatNumber(language, hashBalance, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium uppercase text-slate-500">{t.common.hash}</span>
        </div>

        <div className="glass-card flex items-center gap-1.5 border-neon-purple/30 py-1.5 pl-2.5 pr-1 shadow-neon-purple">
          <Gem size={13} className="text-neon-purple" />
          <span className="text-xs font-semibold tabular-nums text-white">
            {formatNumber(language, tonBalance, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium uppercase text-slate-500">{t.common.ton}</span>
          {/* Ярлик до вже наявного поповнення (DepositModal на /wallet) —
              не нова механіка, лише швидший вхід до існуючого флоу. */}
          <Link
            href="/wallet"
            aria-label={t.nav.wallet}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-cyan text-background shadow-neon-cyan transition active:scale-90"
          >
            <Plus size={12} />
          </Link>
        </div>

        {/* Непомітна іконка входу в /admin — навмисно завжди в розмітці (не
            приховуємо за клієнтською перевіркою telegram_id, бо
            TELEGRAM_ADMIN_IDS — серверний секрет, і його ніде не читати
            в клієнтському коді). Справжній захист — requireAdminAuth() на
            бекенді (lib/admin/auth.ts): для будь-кого, крім акаунтів зі
            списку, /admin одразу поверне "403 Access Denied". Клік звідси
            (а не за посиланням поза Telegram) — єдиний надійний спосіб
            потрапити туди, бо це навігація ВСЕРЕДИНІ вже живої Mini App
            WebView-сесії, тож window.Telegram.WebApp.initData точно є. */}
        <Link
          href="/admin"
          aria-label="Admin"
          className="rounded-full border border-white/5 bg-background-card p-1.5 text-slate-500 transition hover:text-neon-purple"
        >
          <ShieldCheck size={13} />
        </Link>

        <SupportButton />
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, Gem, ShieldCheck } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { LanguageSelector } from "./LanguageSelector";

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
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-background/80 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="glass-card flex items-center gap-1.5 px-3 py-1.5 shadow-neon-cyan">
          <Zap size={14} className="text-neon-cyan" fill="currentColor" />
          <span className="text-sm font-semibold tabular-nums">
            {formatNumber(language, hashBalance, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium uppercase text-white/40">{t.common.hash}</span>
        </div>

        <div className="glass-card flex items-center gap-1.5 px-3 py-1.5 shadow-neon-purple">
          <Gem size={14} className="text-neon-purple" />
          <span className="text-sm font-semibold tabular-nums">
            {formatNumber(language, tonBalance, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium uppercase text-white/40">{t.common.ton}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
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
          className="rounded-full border border-white/10 bg-background-card p-2 text-white/30 transition hover:border-neon-purple/50 hover:text-neon-purple"
        >
          <ShieldCheck size={15} />
        </Link>

        {/* Самодостатній компонент — сам володіє isOpen, закритий за замовчуванням. */}
        <LanguageSelector />
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hexagon, Gem, ShieldCheck, Plus } from "lucide-react";
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
    <header className="sticky top-0 z-40 flex flex-col gap-2.5 border-b border-white/[0.06] bg-background/80 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        {/* Двострочне лого — суто візуальний елемент (реальна назва застосунку,
            metadata.title у app/layout.tsx), без нової механіки. */}
        <div className="flex flex-col leading-none">
          <span className="font-display text-base font-extrabold uppercase tracking-wide text-neon-cyan drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
            Cyber GPU
          </span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.35em] text-white/40">
            Cluster
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="glass-card flex items-center gap-1.5 px-3 py-1.5 shadow-neon-green">
            <Hexagon size={14} className="text-neon-green" fill="currentColor" fillOpacity={0.25} />
            <span className="text-sm font-semibold tabular-nums">
              {formatNumber(language, hashBalance, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] font-medium uppercase text-white/40">{t.common.hash}</span>
          </div>

          <div className="glass-card flex items-center gap-1.5 py-1.5 pl-3 pr-1.5 shadow-neon-purple">
            <Gem size={14} className="text-neon-purple" />
            <span className="text-sm font-semibold tabular-nums">
              {formatNumber(language, tonBalance, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] font-medium uppercase text-white/40">{t.common.ton}</span>
            {/* Ярлик до вже наявного поповнення (DepositModal на /wallet) —
                не нова механіка, лише швидший вхід до існуючого флоу. */}
            <Link
              href="/wallet"
              aria-label={t.nav.wallet}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan transition active:scale-90"
            >
              <Plus size={14} />
            </Link>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* Самодостатній компонент — сам володіє isOpen, закритий за замовчуванням. */}
        <LanguageSelector />

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
      </div>
    </header>
  );
}

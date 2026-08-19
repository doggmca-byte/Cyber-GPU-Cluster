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
  const isAdmin = state.status === "ready" && state.data.is_admin;

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

        {/* Іконка входу в /admin — рендериться лише коли /api/user/sync
            повернув is_admin: true для ПОТОЧНОГО telegram_id (сервер звіряє
            його з TELEGRAM_ADMIN_IDS, сам список ніколи не покидає бекенд —
            див. коментар біля SyncResponse.is_admin). Це лише UX-приховування
            для сторонніх акаунтів; справжній захист лишається на
            requireAdminAuth() (lib/admin/auth.ts): навіть знаючи прямий URL
            /admin, хтось поза списком все одно отримає "403 Access Denied". */}
        {isAdmin && (
          <Link
            href="/admin"
            aria-label="Admin"
            className="rounded-full border border-white/5 bg-background-card p-1.5 text-slate-500 transition hover:text-neon-purple"
          >
            <ShieldCheck size={13} />
          </Link>
        )}

        <SupportButton />
      </div>
    </header>
  );
}

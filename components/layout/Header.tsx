"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Zap, Gem, Globe } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { LANGUAGE_META } from "@/lib/i18n/languages";
import { LanguageModal } from "./LanguageModal";

export function Header() {
  const pathname = usePathname();
  const { state } = useUserData();
  const { language, t } = useTranslation();
  const [isLangOpen, setIsLangOpen] = useState(false);

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

      {/* Лише маленька кнопка-бейдж поточної мови — сама сітка мов рендериться
          в LanguageModal і монтується в DOM тільки за isLangOpen === true. */}
      <button
        type="button"
        onClick={() => setIsLangOpen(true)}
        className="flex items-center gap-1 rounded-full border border-white/10 bg-background-card px-3 py-1.5 text-xs font-medium tracking-wide text-white/80 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
      >
        <Globe size={13} />
        <span>{LANGUAGE_META[language].flag}</span>
        <span className="uppercase">{language}</span>
      </button>

      <LanguageModal open={isLangOpen} onClose={() => setIsLangOpen(false)} />
    </header>
  );
}

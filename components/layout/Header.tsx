"use client";

import { useState } from "react";
import { Zap, Gem, Globe, Check } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { SUPPORTED_LANGUAGES, LANGUAGE_META, type LanguageCode } from "@/lib/i18n/languages";
import { Modal } from "@/components/ui/Modal";

export function Header() {
  const { state } = useUserData();
  const { language, setLanguage, t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);

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

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex items-center gap-1 rounded-full border border-white/10 bg-background-card px-3 py-1.5 text-xs font-medium tracking-wide text-white/80 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
      >
        <Globe size={13} />
        <span>{LANGUAGE_META[language].flag}</span>
        <span className="uppercase">{language}</span>
      </button>

      {pickerOpen && (
        <Modal title={t.language.pickerTitle} onClose={() => setPickerOpen(false)}>
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_LANGUAGES.map((code) => (
              <LanguageOption
                key={code}
                code={code}
                active={code === language}
                onSelect={() => {
                  setLanguage(code);
                  setPickerOpen(false);
                }}
              />
            ))}
          </div>
        </Modal>
      )}
    </header>
  );
}

function LanguageOption({
  code,
  active,
  onSelect,
}: {
  code: LanguageCode;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = LANGUAGE_META[code];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm transition ${
        active
          ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
          : "border-white/10 text-white/70 hover:border-white/20 hover:text-white/90"
      }`}
    >
      <span className="text-lg leading-none">{meta.flag}</span>
      <span className="min-w-0 flex-1 truncate">{meta.nativeName}</span>
      {active && <Check size={14} className="shrink-0" />}
    </button>
  );
}

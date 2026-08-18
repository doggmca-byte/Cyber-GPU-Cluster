"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { SUPPORTED_LANGUAGES, LANGUAGE_META, type LanguageCode } from "@/lib/i18n/languages";

/**
 * Самодостатній компонент: сам володіє isOpen (useState(false) — закритий за
 * замовчуванням) і сам рендерить і кнопку-бейдж, і модалку. Замінює попередню
 * пару Header.tsx + LanguageModal.tsx, де стан жив у Header і прокидався пропсами —
 * функціонально те саме, але тут немає жодного проміжного прошарку між кнопкою
 * і `{isOpen && (...)}`, тож немає де сховатись багу "модалка не закривається".
 */
export function LanguageSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const { language, setLanguage, t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const activeMeta = LANGUAGE_META[language];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#161F33] px-2.5 py-1 text-xs font-semibold text-white transition-transform active:scale-95"
      >
        <span>{activeMeta.flag}</span>
        <span className="uppercase">{language}</span>
        <span className="text-[10px] text-gray-400">▼</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-xs space-y-3 rounded-2xl border border-[#1E293B] bg-[#101726] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
              <span className="text-sm font-bold text-white">{t.language.pickerTitle}</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label={t.common.close}
                className="px-2 py-1 text-base text-gray-400 transition hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto">
              {SUPPORTED_LANGUAGES.map((code) => (
                <LanguageOption
                  key={code}
                  code={code}
                  active={code === language}
                  onSelect={() => {
                    setLanguage(code);
                    setIsOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
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
      className={`flex items-center gap-2 rounded-xl border p-2.5 text-start text-xs font-semibold transition-all ${
        active
          ? "border-[#00F0FF] bg-[#00F0FF]/15 text-[#00F0FF]"
          : "border-[#1E293B] bg-[#161F33] text-gray-300 hover:border-gray-500"
      }`}
    >
      <span className="text-base leading-none">{meta.flag}</span>
      <span className="min-w-0 flex-1 truncate">{meta.nativeName}</span>
      {active && <Check size={13} className="shrink-0" />}
    </button>
  );
}

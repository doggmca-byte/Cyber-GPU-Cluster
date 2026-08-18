"use client";

import { useEffect } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { SUPPORTED_LANGUAGES, LANGUAGE_META, type LanguageCode } from "@/lib/i18n/languages";

interface LanguageModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Центрована модалка вибору мови — НАВМИСНО окрема від спільного bottom-sheet
 * components/ui/Modal.tsx (той з'їжджає знизу, ця суворо по центру екрана з
 * повноекранним затемненням). Рендериться (повертає щось відмінне від null)
 * ЛИШЕ коли `open === true` — це і є фікс бага, коли сітка мов раніше
 * малювалась як звичайний блок у розмітці Header на кожній вкладці.
 */
export function LanguageModal({ open, onClose }: LanguageModalProps) {
  const { language, setLanguage, t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs space-y-4 rounded-2xl border border-[#1E293B] bg-[#101726] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
          <span className="text-sm font-bold text-white">{t.language.pickerTitle}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="text-lg text-gray-400 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {SUPPORTED_LANGUAGES.map((code) => (
            <LanguageOption
              key={code}
              code={code}
              active={code === language}
              onSelect={() => {
                setLanguage(code);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
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
          ? "border-[#00F0FF] bg-[#00F0FF]/10 text-[#00F0FF]"
          : "border-[#1E293B] bg-[#161F33] text-gray-300 hover:border-gray-500"
      }`}
    >
      <span className="text-base leading-none">{meta.flag}</span>
      <span className="min-w-0 flex-1 truncate">{meta.nativeName}</span>
      {active && <Check size={13} className="shrink-0" />}
    </button>
  );
}

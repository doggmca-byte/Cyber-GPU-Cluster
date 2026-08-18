"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Мінімальний glass-модал знизу екрана (bottom sheet), консистентний з темою. */
export function Modal({ title, onClose, children }: ModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={t.common.close}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="glass-card relative z-10 w-full max-w-lg rounded-b-none border-b-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

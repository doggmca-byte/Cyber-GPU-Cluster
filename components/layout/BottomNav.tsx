"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ArrowLeftRight, Cpu, Store, Users } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// Farm — головний ігровий екран, тому живе на "/"; Wallet переїхав на "/wallet".
const TABS = [
  { href: "/wallet", labelKey: "wallet", icon: Wallet },
  { href: "/exchange", labelKey: "exchange", icon: ArrowLeftRight },
  { href: "/", labelKey: "farm", icon: Cpu },
  { href: "/market", labelKey: "market", icon: Store },
  { href: "/friends", labelKey: "friends", icon: Users },
] as const satisfies ReadonlyArray<{
  href: string;
  labelKey: keyof TranslationDictionary["nav"];
  icon: typeof Wallet;
}>;

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-background/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
        {TABS.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname === href;

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                  active ? "text-neon-green" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    active ? "bg-neon-green" : ""
                  }`}
                >
                  <Icon size={18} strokeWidth={1.75} className={active ? "text-background" : ""} />
                </span>
                {t.nav[labelKey]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, Settings2 } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { MinerIcon } from "@/components/miners/MinerIcons";
import { GpuCyclesModal } from "@/components/market/GpuCyclesModal";
import type { BuyGpuResponse, GpuTemplate, SyncResponse } from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

const RARITY_COLOR: Record<string, string> = {
  common: "text-white/60 border-white/20 bg-white/5",
  uncommon: "text-neon-green border-neon-green/30 bg-neon-green/10",
  rare: "text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10",
  elite: "text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10",
  epic: "text-neon-purple border-neon-purple/30 bg-neon-purple/10",
  legendary: "text-neon-gold border-neon-gold/30 bg-neon-gold/10",
  mythic: "text-neon-purple border-neon-purple/30 bg-neon-purple/10",
  ancient: "text-neon-gold border-neon-gold/30 bg-neon-gold/10",
  divine: "text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10",
  transcendent: "text-neon-purple border-neon-purple/30 bg-neon-purple/10",
};

function getRarityLabel(t: TranslationDictionary, rarity: string): string {
  return t.rarity[rarity as keyof TranslationDictionary["rarity"]] ?? rarity;
}

export function MarketScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <MarketScreenReady data={state.data} initData={state.initData} />;
}

function MarketScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  const { t, language } = useTranslation();
  const { patchProfile, patchUserGpuAmount } = useUserData();
  const { profile, user_gpus, gpu_templates } = data;

  const amountByLevel = new Map(user_gpus.map((g) => [g.gpu_level, g.amount]));
  const deadByLevel = new Map(user_gpus.map((g) => [g.gpu_level, g.is_dead]));

  const [buyingLevel, setBuyingLevel] = useState<number | null>(null);
  const [errorByLevel, setErrorByLevel] = useState<Record<number, string>>({});
  const [cyclesTemplate, setCyclesTemplate] = useState<GpuTemplate | null>(null);

  const buy = async (template: GpuTemplate) => {
    if (buyingLevel !== null) return;

    setBuyingLevel(template.level);
    setErrorByLevel((prev) => ({ ...prev, [template.level]: "" }));

    // оптимістичний UI: одразу списуємо вартість і додаємо картку
    patchProfile({ game_balance: profile.game_balance - template.cost_ton });
    patchUserGpuAmount(template.level, 1);

    try {
      const res = await fetch("/api/farm/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, gpu_level: template.level }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `buy failed with status ${res.status}`);
      }

      const result = (await res.json()) as BuyGpuResponse;
      // узгоджуємо з реальними серверними цифрами (harvest міг додати трохи HASH)
      patchProfile({
        game_balance: result.new_game_balance,
        hash_balance: profile.hash_balance + result.hash_harvested,
      });
    } catch (err) {
      // відкат оптимістичного патча
      patchProfile({ game_balance: profile.game_balance });
      patchUserGpuAmount(template.level, -1);
      setErrorByLevel((prev) => ({
        ...prev,
        [template.level]: err instanceof Error ? err.message : t.common.unknownError,
      }));
    } finally {
      setBuyingLevel(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card flex items-center justify-between px-4 py-2.5 shadow-neon-cyan">
        <span className="text-xs uppercase tracking-wide text-white/50">{t.market.gameBalance}</span>
        <span className="font-display text-sm font-bold text-neon-cyan">
          {formatNumber(language, profile.game_balance, { maximumFractionDigits: 2 })} {t.common.ton}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {gpu_templates.map((template) => (
          <GpuCard
            key={template.level}
            template={template}
            owned={amountByLevel.get(template.level) ?? 0}
            isDead={deadByLevel.get(template.level) ?? false}
            isBuying={buyingLevel === template.level}
            disabled={buyingLevel !== null}
            error={errorByLevel[template.level]}
            onBuy={() => buy(template)}
            onOpenCycles={() => setCyclesTemplate(template)}
          />
        ))}
      </div>

      {cyclesTemplate && (
        <GpuCyclesModal
          template={cyclesTemplate}
          maxQuantity={cyclesTemplate.max_limit}
          onClose={() => setCyclesTemplate(null)}
        />
      )}
    </div>
  );
}

function GpuCard({
  template,
  owned,
  isDead,
  isBuying,
  disabled,
  error,
  onBuy,
  onOpenCycles,
}: {
  template: GpuTemplate;
  owned: number;
  isDead: boolean;
  isBuying: boolean;
  disabled: boolean;
  error?: string;
  onBuy: () => void;
  onOpenCycles: () => void;
}) {
  const { t, language } = useTranslation();
  const isMaxed = owned >= template.max_limit;
  const rarityClass = RARITY_COLOR[template.rarity] ?? RARITY_COLOR.common;
  const rarityLabel = getRarityLabel(t, template.rarity);
  const hashPerHour = template.hash_per_second * 3600;
  const hashPerDay = hashPerHour * 24;

  return (
    <div className="glass-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-neon-cyan/10">
          <MinerIcon level={template.level} rarity={template.rarity} className="h-6 w-6" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{template.name}</p>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rarityClass}`}
            >
              {rarityLabel}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-white/40">{t.market.owned(owned, template.max_limit)}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
            <span className="flex items-center gap-1">
              <Zap size={12} className="text-neon-green" />
              {t.market.hashPerHour(formatNumber(language, hashPerHour, { maximumFractionDigits: 2 }))}
            </span>
            <span className="text-white/30">
              {t.market.hashPerDay(formatNumber(language, hashPerDay, { maximumFractionDigits: 2 }))}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenCycles}
          aria-label={t.market.cycles.openButton}
          className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-neon-green/40 hover:text-neon-green"
        >
          <Settings2 size={15} />
        </button>
      </div>

      <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
          style={{ width: `${Math.min(owned / template.max_limit, 1) * 100}%` }}
        />
      </div>

      {isDead ? (
        <Link
          href="/"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-400/10 py-2.5 text-xs font-bold uppercase tracking-wide text-red-400 transition active:scale-[0.98]"
        >
          {t.market.reviveOnFarm}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onBuy}
          disabled={disabled || isMaxed}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple py-2.5 text-sm font-bold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isMaxed
            ? t.market.limitReached
            : isBuying
              ? t.market.buying
              : t.market.buy(formatNumber(language, template.cost_ton, { maximumFractionDigits: 2 }))}
        </button>
      )}

      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}

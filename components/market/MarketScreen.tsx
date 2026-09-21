"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, Settings2, Timer } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { MinerIcon } from "@/components/miners/MinerIcons";
import { GpuCyclesModal } from "@/components/market/GpuCyclesModal";
import {
  effectivePrice,
  formatCountdown,
  isLevelDiscounted,
  promoMsLeft,
  splitCountdown,
  type PromoState,
} from "@/lib/promo/promo";
import { isAnniversaryPromo } from "@/lib/promo/anniversary";
import type { BuyGpuResponse, GpuTemplate, SyncResponse } from "@/types/api";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

const RARITY_COLOR: Record<string, string> = {
  common: "text-slate-400 border-slate-600/30 bg-slate-500/10",
  uncommon: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
  rare: "text-cyan-400 border-cyan-500/20 bg-cyan-500/10",
  elite: "text-cyan-400 border-cyan-500/20 bg-cyan-500/10",
  epic: "text-violet-400 border-violet-500/20 bg-violet-500/10",
  legendary: "text-amber-400 border-amber-500/20 bg-amber-500/10",
  mythic: "text-violet-400 border-violet-500/20 bg-violet-500/10",
  ancient: "text-amber-400 border-amber-500/20 bg-amber-500/10",
  divine: "text-cyan-400 border-cyan-500/20 bg-cyan-500/10",
  transcendent: "text-violet-400 border-violet-500/20 bg-violet-500/10",
};

function getRarityLabel(t: TranslationDictionary, rarity: string): string {
  return t.rarity[rarity as keyof TranslationDictionary["rarity"]] ?? rarity;
}

export function MarketScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <MarketScreenReady data={state.data} initData={state.initData} clockOffsetMs={state.clockOffsetMs} />;
}

/**
 * "Зараз" за шкалою СЕРВЕРА: годинник пристрою + поправка clockOffsetMs
 * (різниця "сервер - пристрій" з UserDataProvider, оновлюється з кожної
 * відповіді бекенду). Так зворотний відлік і зникнення знижки не залежать від
 * системного годинника пристрою — і, на відміну від відліку від server_time
 * на момент монтування, не "відстають" після повернення на вкладку Маркет
 * (списання все одно рахує buy_gpu за now() у БД). Інтервал знімається при
 * розмонтуванні.
 */
function useServerNow(clockOffsetMs: number): number {
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);

  useEffect(() => {
    const tick = () => setNowMs(Date.now() + clockOffsetMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clockOffsetMs]);

  return nowMs;
}

function MarketScreenReady({
  data,
  initData,
  clockOffsetMs,
}: {
  data: SyncResponse;
  initData: string;
  clockOffsetMs: number;
}) {
  const { t, language } = useTranslation();
  const { applyGpuPurchase } = useUserData();
  const { profile, user_gpus, gpu_templates, promo } = data;

  // Тік раз на секунду — коли час акції спливає, msLeft стає 0, і всі бейджі
  // та ціни реактивно повертаються до базових БЕЗ перезавантаження сторінки.
  const nowMs = useServerNow(clockOffsetMs);
  const msLeft = promoMsLeft(promo, nowMs);
  const countdown = splitCountdown(msLeft);

  const amountByLevel = new Map(user_gpus.map((g) => [g.gpu_level, g.amount]));
  const deadByLevel = new Map(user_gpus.map((g) => [g.gpu_level, g.is_dead]));

  const [buyingLevel, setBuyingLevel] = useState<number | null>(null);
  const [errorByLevel, setErrorByLevel] = useState<Record<number, string>>({});
  const [cyclesTemplate, setCyclesTemplate] = useState<GpuTemplate | null>(null);

  // ЖОДНОГО оптимістичного оновлення: ані картка, ані баланс не змінюються,
  // доки бекенд не підтвердив транзакцію. Раніше картку додавали одразу після
  // кліку, а на помилці (напр. недостатньо game_balance) відкочували
  // дельтою -1 — рядок лишався в стані з amount = 0 і рендерився на Фермі як
  // "фантомний сервер" із +0 HASH/год до наступного повного sync. Тепер
  // єдине джерело правди — відповідь /api/farm/buy.
  const buy = async (template: GpuTemplate) => {
    if (buyingLevel !== null) return;

    setBuyingLevel(template.level);
    setErrorByLevel((prev) => ({ ...prev, [template.level]: "" }));

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

      // Успіх — і лише тут стан обладнання та баланси беруться з відповіді
      // бекенду як є (масив user_gpus, потужність, game_balance, harvest).
      applyGpuPurchase((await res.json()) as BuyGpuResponse);
    } catch (err) {
      // Помилка — стан не чіпаємо взагалі, лише показуємо причину на картці.
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
      <div className="glass-card flex items-center justify-between px-4 py-2.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{t.market.gameBalance}</span>
        <span className="text-sm font-semibold text-neon-cyan">
          {formatNumber(language, profile.game_balance, { maximumFractionDigits: 2 })} {t.common.ton}
        </span>
      </div>

      {msLeft > 0 && promo && isAnniversaryPromo(promo) && (
        // Святкова неонова плашка юбілейної акції. Два рядки (текст + відлік),
        // а не один, — довгий локалізований заголовок не обрізається на
        // вузьких екранах, а tabular-nums тримає ширину відліку сталою.
        <div className="relative overflow-hidden rounded-2xl border border-neon-gold/40 bg-gradient-to-r from-neon-purple/20 via-neon-gold/15 to-neon-cyan/20 px-3.5 py-3 shadow-[0_0_1px_rgba(251,191,36,0.8),0_0_24px_rgba(251,191,36,0.25)]">
          <p className="text-xs font-bold text-neon-gold">{t.market.promo.anniversaryBanner(promo.discount_percent)}</p>
          <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums text-white/90">
            <Timer size={12} className="shrink-0 text-neon-gold" />
            {t.market.promo.endsIn(countdown.days, countdown.time)}
          </p>
        </div>
      )}

      {msLeft > 0 && promo && !isAnniversaryPromo(promo) && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-neon-gold/30 bg-neon-gold/10 px-3 py-2">
          <span className="min-w-0 truncate text-[11px] font-semibold text-neon-gold">
            {t.market.promo.banner(promo.discount_percent)}
          </span>
          {/* tabular-nums + фіксований формат HH:MM:SS — ширина не стрибає
              щосекунди, тож верстку не зсуває навіть на вузьких екранах. */}
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-bold tabular-nums text-neon-gold">
            <Timer size={12} />
            {formatCountdown(msLeft)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {gpu_templates.map((template) => (
          <GpuCard
            key={template.level}
            template={template}
            owned={amountByLevel.get(template.level) ?? 0}
            isDead={deadByLevel.get(template.level) ?? false}
            isBuying={buyingLevel === template.level}
            disabled={buyingLevel !== null}
            error={errorByLevel[template.level]}
            discounted={isLevelDiscounted(promo, template.level, nowMs)}
            discountPercent={promo?.discount_percent ?? 0}
            price={effectivePrice(promo, template.level, template.cost_ton, nowMs)}
            balance={profile.game_balance}
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
  discounted,
  discountPercent,
  price,
  balance,
  onBuy,
  onOpenCycles,
}: {
  template: GpuTemplate;
  owned: number;
  isDead: boolean;
  isBuying: boolean;
  disabled: boolean;
  error?: string;
  /** Чи діє знижка саме на цю модель ПРЯМО ЗАРАЗ (за часом сервера). */
  discounted: boolean;
  discountPercent: number;
  /** Ціна, яку реально спише бекенд: акційна або базова. */
  price: number;
  /** Ігровий баланс гравця — щоб не пускати в купівлю, на яку не вистачає. */
  balance: number;
  onBuy: () => void;
  onOpenCycles: () => void;
}) {
  const { t, language } = useTranslation();
  const isMaxed = owned >= template.max_limit;
  const rarityClass = RARITY_COLOR[template.rarity] ?? RARITY_COLOR.common;
  const rarityLabel = getRarityLabel(t, template.rarity);
  // Ціни й баланси — дробові, тож пряме порівняння дало б "не вистачає
  // 0.0000000001" на рівному балансі. Епсилон прибирає саме цей випадок і
  // нічого більше: сервер однаково лишається останнім словом у покупці.
  const shortBy = price - balance;
  const canAfford = shortBy <= 1e-9;
  const hashPerHour = template.hash_per_second * 3600;
  const hashPerDay = hashPerHour * 24;

  return (
    <div className="glass-card p-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5">
          <MinerIcon level={template.level} rarity={template.rarity} className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-white">{template.name}</p>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${rarityClass}`}
            >
              {rarityLabel}
            </span>
            {discounted && (
              <span className="shrink-0 rounded-full border border-neon-gold/40 bg-neon-gold/15 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-neon-gold shadow-neon-gold">
                -{discountPercent}%
              </span>
            )}
          </div>

          <p className="mt-0.5 text-[10px] text-slate-500">{t.market.owned(owned, template.max_limit)}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Zap size={10} className="text-neon-green" />
              {t.market.hashPerHour(formatNumber(language, hashPerHour, { maximumFractionDigits: 2 }))}
            </span>
            <span className="text-slate-600">
              {t.market.hashPerDay(formatNumber(language, hashPerDay, { maximumFractionDigits: 2 }))}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenCycles}
          aria-label={t.market.cycles.openButton}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:text-neon-green"
        >
          <Settings2 size={14} />
        </button>
      </div>

      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-neon-cyan"
          style={{ width: `${Math.min(owned / template.max_limit, 1) * 100}%` }}
        />
      </div>

      {isDead ? (
        <Link
          href="/"
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 py-2 text-xs font-semibold text-red-400 transition active:scale-[0.98]"
        >
          {t.market.reviveOnFarm}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onBuy}
          disabled={disabled || isMaxed || !canAfford}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-neon-green py-2 text-xs font-semibold text-background transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isMaxed ? (
            t.market.limitReached
          ) : isBuying ? (
            t.market.buying
          ) : discounted ? (
            <span className="flex items-center gap-1.5">
              <span className="text-background/60 line-through">
                {formatNumber(language, template.cost_ton, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
              </span>
              {/* До 4 знаків: 15% від 0.25 / 0.75 дає 0.2125 / 0.6375 — бекенд
                  списує цю суму точно, тож на кнопці показуємо її без округлення. */}
              {t.market.buy(formatNumber(language, price, { minimumFractionDigits: 2, maximumFractionDigits: 4 }))}
            </span>
          ) : (
            t.market.buy(formatNumber(language, template.cost_ton, { maximumFractionDigits: 2 }))
          )}
        </button>
      )}

      {!isMaxed && !isDead && !canAfford && (
        <p className="mt-1.5 text-center text-[10px] text-slate-500">
          {t.market.notEnough(formatNumber(language, shortBy, { maximumFractionDigits: 3 }))}
        </p>
      )}

      {error && <p className="mt-2 text-center text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

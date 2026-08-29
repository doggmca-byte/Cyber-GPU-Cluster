"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Zap, Gift, Cpu, Bot, Copy, Check, Server, ChevronRight, CirclePlus, PauseCircle, Clock } from "lucide-react";
import { useMiningEngine } from "@/hooks/useMiningEngine";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { HarvestResponse, SyncResponse } from "@/types/api";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { TasksEntryButton } from "@/components/tasks/TasksEntryButton";
import { DailyBonusModal } from "@/components/daily/DailyBonusModal";
import { WriteAccessPrompt } from "@/components/farm/WriteAccessPrompt";
import { MinerIcon, getRarityColorHex } from "@/components/miners/MinerIcons";
import { MAX_UNCLAIMED_SECONDS, gpuLifecycleCapHash, gpuRevivalCost, GPU_REVIVAL_MAX_COUNT } from "@/lib/constants/economy";
import type { ReviveGpuResponse } from "@/types/api";

export function FarmScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <FarmScreenReady data={state.data} initData={state.initData} />;
}

function FarmScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  const { patchProfile } = useUserData();
  const { profile, user_gpus, gpu_templates, total_hash_per_second, server_time } = data;

  const templateByLevel = useMemo(
    () => new Map(gpu_templates.map((tmpl) => [tmpl.level, tmpl])),
    [gpu_templates],
  );

  // Скільки $HASH уже накопичено, але ще не забрано, ЗАРАЗ (на момент
  // server_time) — сума (server_time - last_harvest_at) * hash_per_second *
  // amount по кожній картці, той самий розрахунок (включно з капом
  // MAX_UNCLAIMED_SECONDS на кожен елапсед), що виконує harvest_user_hash на
  // бекенді. Рахуємо це, а не беремо profile.hash_balance як базу — інакше
  // великий лічильник показував би загальний баланс і "стрибав" би на нього
  // ж таки після харвесту (баг, знайдений тестуванням на реальному пристрої).
  //
  // capRemainingSeconds — скільки секунд лишилось до НАЙБЛИЖЧОГО капа (12г
  // без харвесту АБО lifecycle-ліміт картки, залежно, що настане раніше) в
  // НАЙБЛИЖЧОЇ картки (мінімум по всіх живих). useMiningEngine заморожує
  // живий лічильник рівно тоді, коли цей бюджет вичерпається, — інакше він
  // показував би більше, ніж сервер реально нарахує при харвесті (той самий
  // клас бага). Мертві (is_dead) картки взагалі не рахуються — сервер для
  // них теж пропускає нарахування (continue в harvest_user_hash).
  const { initialUnclaimedHash, capRemainingSeconds } = useMemo(() => {
    const serverTimeMs = new Date(server_time).getTime();
    let unclaimed = 0;
    let remaining = Infinity;
    let hasOwnedGpu = false;

    for (const gpu of user_gpus) {
      if (gpu.amount <= 0 || gpu.is_dead) continue;
      const template = templateByLevel.get(gpu.gpu_level);
      if (!template) continue;
      hasOwnedGpu = true;

      const rate = template.hash_per_second * gpu.amount;
      const elapsedSeconds = Math.max((serverTimeMs - new Date(gpu.last_harvest_at).getTime()) / 1000, 0);
      const cappedByTime = Math.min(elapsedSeconds, MAX_UNCLAIMED_SECONDS);
      const rowHarvestedByTime = cappedByTime * rate;

      const rowCap = gpuLifecycleCapHash(template.cost_ton, gpu.amount);
      const rowHeadroom = Math.max(rowCap - gpu.lifetime_hash_generated, 0);
      const rowHarvested = Math.min(rowHarvestedByTime, rowHeadroom);
      unclaimed += rowHarvested;

      const secondsUntilTimeCap = MAX_UNCLAIMED_SECONDS - cappedByTime;
      const secondsUntilLifecycleCap = rate > 0 ? Math.max(rowHeadroom - rowHarvestedByTime, 0) / rate : Infinity;
      remaining = Math.min(remaining, secondsUntilTimeCap, secondsUntilLifecycleCap);
    }

    return {
      initialUnclaimedHash: unclaimed,
      capRemainingSeconds: hasOwnedGpu ? remaining : null,
    };
  }, [user_gpus, templateByLevel, server_time]);

  const handleHarvestSuccess = useCallback(
    (result: HarvestResponse) => {
      // Пропатчити глобальний стан одразу — Header (HASH/TON бейджі) та решта
      // екранів мають побачити нові баланси без очікування наступного
      // повного /api/user/sync.
      patchProfile({
        hash_balance: result.hash_balance,
        game_balance: result.game_balance,
        withdrawable_balance: result.withdrawable_balance,
      });
    },
    [patchProfile],
  );

  const { unclaimedHash, isAtCap, isHarvesting, harvestError, harvest } = useMiningEngine({
    initialUnclaimedHash,
    capRemainingSecondsAtServerTime: capRemainingSeconds,
    totalHashPerSecond: total_hash_per_second,
    serverTime: server_time,
    initData,
    onHarvestSuccess: handleHarvestSuccess,
  });

  // Косметичні дані (аватар) беремо напряму з initDataUnsafe на клієнті —
  // це не довірені дані і НЕ використовуються ні для чого, крім фото в UI.
  // Джерело правди для id/балансів — виключно верифікована відповідь сервера.
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  useEffect(() => {
    setPhotoUrl(window.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url);
  }, []);

  const displayName = profile.first_name || profile.username || `#${profile.telegram_id}`;
  const hashPerHour = total_hash_per_second * 3600;

  const [isDailyBonusOpen, setIsDailyBonusOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard
        displayName={displayName}
        username={profile.username}
        telegramId={profile.telegram_id}
        photoUrl={photoUrl}
        onOpenDailyBonus={() => setIsDailyBonusOpen(true)}
      />

      {isDailyBonusOpen && (
        <DailyBonusModal initData={initData} onClose={() => setIsDailyBonusOpen(false)} />
      )}

      <WriteAccessPrompt />

      <TasksEntryButton initData={initData} />

      <MiningPanel
        hashPerHour={hashPerHour}
        unclaimedHash={unclaimedHash}
        isAtCap={isAtCap}
        isHarvesting={isHarvesting}
        harvestError={harvestError}
        onHarvest={harvest}
      />

      <ActiveServersSection
        userGpus={user_gpus}
        templateByLevel={templateByLevel}
        initData={initData}
        isAtCap={isAtCap}
      />
    </div>
  );
}

function ProfileCard({
  displayName,
  username,
  telegramId,
  photoUrl,
  onOpenDailyBonus,
}: {
  displayName: string;
  username: string | null;
  telegramId: number;
  photoUrl?: string;
  onOpenDailyBonus: () => void;
}) {
  const { t } = useTranslation();
  const initial = displayName.charAt(0).toUpperCase();
  const [copied, setCopied] = useState(false);

  const copyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(String(telegramId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API може бути недоступний (дозволи/контекст) — тихо ігноруємо,
      // це суто зручність, а не критична дія.
    }
  }, [telegramId]);

  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 shadow-lg backdrop-blur-xl">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-cyan-400/30 bg-background-card shadow-[0_0_1px_rgba(34,211,238,0.8),0_0_16px_rgba(34,211,238,0.35)]">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-sm font-bold text-neon-cyan">
            {initial}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{displayName}</p>
        {username && <p className="truncate text-[11px] text-slate-500">@{username}</p>}

        <button
          type="button"
          onClick={() => void copyId()}
          className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-500 transition hover:text-slate-300"
        >
          ID: {telegramId}
          {copied ? <Check size={10} className="text-neon-green" /> : <Copy size={10} />}
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenDailyBonus}
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-3 py-2.5 text-xs font-bold text-background shadow-[0_0_1px_rgba(251,191,36,0.8),0_0_18px_rgba(251,191,36,0.4)] transition active:scale-90"
      >
        <Gift size={13} />
        {t.farm.dailyBonus}
      </button>
    </div>
  );
}

function MiningPanel({
  hashPerHour,
  unclaimedHash,
  isAtCap,
  isHarvesting,
  harvestError,
  onHarvest,
}: {
  hashPerHour: number;
  unclaimedHash: number;
  isAtCap: boolean;
  isHarvesting: boolean;
  harvestError: string | null;
  onHarvest: () => void;
}) {
  const { t, language } = useTranslation();

  return (
    <div className="relative flex flex-col items-center gap-2 overflow-hidden rounded-2xl border border-cyan-400/20 bg-white/[0.04] px-5 py-6 shadow-[0_0_1px_rgba(34,211,238,0.8),0_0_30px_rgba(34,211,238,0.22)] backdrop-blur-xl">
      {/* Ambient mesh glow — суто декоративні розмиті плями, без впливу на layout. */}
      <div className="pointer-events-none absolute -top-16 left-1/2 h-44 w-72 -translate-x-1/2 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-0 h-40 w-40 rounded-full bg-purple-500/15 blur-3xl" />

      <div className="relative flex w-full items-center justify-between">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/5 bg-white/5">
          <Bot size={13} className="shrink-0 text-slate-500" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
          {t.farm.totalPower}
        </span>
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/5 bg-white/5">
          <Cpu size={13} className="shrink-0 text-slate-500" />
        </div>
      </div>

      <div className="relative flex items-center gap-1.5">
        {!isAtCap && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon-green shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse [animation-duration:1.6s]" />
        )}
        <span className="font-mono text-sm font-semibold tabular-nums text-neon-green">
          +{formatNumber(language, hashPerHour, { maximumFractionDigits: 2 })} {t.farm.hashPerHourSuffix}
        </span>
      </div>

      <span className="relative text-[10px] uppercase tracking-widest text-slate-500">
        {t.farm.accumulatedHash}
      </span>

      <span className="relative bg-gradient-to-r from-cyan-300 via-white to-cyan-300 bg-clip-text font-mono text-2xl font-bold tabular-nums text-transparent">
        {formatNumber(language, unclaimedHash, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })}
      </span>
      <span className="relative -mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {t.common.hash}
      </span>

      {isAtCap && (
        <div className="relative flex items-center gap-1.5 rounded-full border border-neon-gold/20 bg-neon-gold/10 px-3 py-1.5 text-[10px] font-medium text-neon-gold shadow-[0_0_16px_rgba(251,191,36,0.2)]">
          <PauseCircle size={12} className="shrink-0" />
          {t.farm.productionPaused}
        </div>
      )}

      <button
        type="button"
        onClick={onHarvest}
        disabled={isHarvesting}
        className="relative mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-500 py-3 text-xs font-bold uppercase tracking-wide text-background shadow-[0_0_1px_rgba(52,211,153,0.9),0_0_24px_rgba(52,211,153,0.4)] transition active:scale-[0.96] disabled:opacity-50 disabled:shadow-none"
      >
        {isHarvesting ? t.farm.harvesting : t.farm.harvestButton}
        {!isHarvesting && (
          <Zap size={14} fill="currentColor" className="drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
        )}
      </button>

      {harvestError && <p className="relative text-center text-[11px] text-red-400">{harvestError}</p>}
    </div>
  );
}

function ActiveServersSection({
  userGpus,
  templateByLevel,
  initData,
  isAtCap,
}: {
  userGpus: SyncResponse["user_gpus"];
  templateByLevel: Map<number, SyncResponse["gpu_templates"][number]>;
  initData: string;
  isAtCap: boolean;
}) {
  const { t } = useTranslation();

  // Живий тік раз/с для "UPTIME" на кожній картці — не нова механіка, лише
  // інше клієнтське представлення вже наявного gpu.last_harvest_at (час, що
  // минув відтоді, як картка востаннє була харвестнута = скільки вона
  // "безперервно" накопичує $HASH прямо зараз).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const ownedCount = userGpus.filter((gpu) => gpu.amount > 0).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-400">
            <Server size={12} />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t.farm.activeServers}
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums">
          <span className="text-neon-green">{ownedCount}</span>
          <span className="text-slate-600"> / {templateByLevel.size}</span>
        </span>
      </div>

      {userGpus.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <Server size={20} className="text-slate-600" />
          <p className="text-xs text-slate-500">{t.farm.emptyGpuList}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {userGpus.map((gpu) => {
            const template = templateByLevel.get(gpu.gpu_level);
            if (!template) return null;
            return (
              <ServerRow
                key={gpu.id}
                gpu={gpu}
                template={template}
                now={now}
                initData={initData}
                isAtCap={isAtCap}
              />
            );
          })}
        </div>
      )}

      <Link
        href="/market"
        className="flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 py-3 text-xs font-bold uppercase tracking-wide text-neon-cyan transition active:scale-[0.97] hover:border-cyan-400/60 hover:bg-cyan-400/10 hover:shadow-[0_0_20px_rgba(34,211,238,0.2)]"
      >
        <CirclePlus size={14} />
        {t.farm.buyNewServer}
      </Link>
    </div>
  );
}

function ServerRow({
  gpu,
  template,
  now,
  initData,
  isAtCap,
}: {
  gpu: SyncResponse["user_gpus"][number];
  template: SyncResponse["gpu_templates"][number];
  now: number;
  initData: string;
  isAtCap: boolean;
}) {
  const { t, language } = useTranslation();
  const { patchGpuRevived } = useUserData();

  const [isReviving, setIsReviving] = useState(false);
  const [reviveError, setReviveError] = useState<string | null>(null);

  const rarityLabel = getRarityLabel(t, template.rarity);

  const revive = async () => {
    if (isReviving) return;
    setIsReviving(true);
    setReviveError(null);

    try {
      const res = await fetch("/api/farm/revive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, gpu_level: template.level }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `revive failed with status ${res.status}`);
      }

      const result = (await res.json()) as ReviveGpuResponse;
      patchGpuRevived(template.level, result.new_game_balance, result.revival_count);
    } catch (err) {
      setReviveError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setIsReviving(false);
    }
  };

  if (gpu.is_dead) {
    const canRevive = gpu.revival_count < GPU_REVIVAL_MAX_COUNT;
    const revivalCost = gpuRevivalCost(template.cost_ton, gpu.amount, gpu.revival_count);

    return (
      <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 opacity-70">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 grayscale">
          <MinerIcon level={template.level} rarity={template.rarity} className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-400">{template.name}</p>
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {t.farm.gpuDead}
            </span>
          </div>
          <p className="truncate text-[10px] text-slate-600">
            {t.farm.reviveCount(gpu.revival_count, GPU_REVIVAL_MAX_COUNT)}
          </p>

          {canRevive ? (
            <button
              type="button"
              onClick={() => void revive()}
              disabled={isReviving}
              className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-neon-gold/20 bg-gradient-to-r from-amber-400/15 to-yellow-600/15 px-2.5 py-1.5 text-[10px] font-bold text-neon-gold transition active:scale-90 disabled:opacity-50"
            >
              {isReviving
                ? t.farm.reviving
                : t.farm.reviveButton(formatNumber(language, revivalCost, { maximumFractionDigits: 3 }))}
            </button>
          ) : (
            <p className="mt-1.5 text-[10px] font-medium text-red-400">{t.farm.reviveMaxReached}</p>
          )}

          {reviveError && <p className="mt-1 text-[10px] text-red-400">{reviveError}</p>}
        </div>
      </div>
    );
  }

  const progress = Math.min(gpu.amount / template.max_limit, 1) * 100;
  const uptimeSeconds = Math.max((now - new Date(gpu.last_harvest_at).getTime()) / 1000, 0);
  const lifecycleCap = gpuLifecycleCapHash(template.cost_ton, gpu.amount);
  const lifecycleProgress = lifecycleCap > 0 ? Math.min(gpu.lifetime_hash_generated / lifecycleCap, 1) * 100 : 0;

  const rarityGlow = getRarityColorHex(template.rarity);

  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 backdrop-blur-xl transition hover:border-cyan-400/25">
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border"
        style={{ borderColor: `${rarityGlow}40`, backgroundColor: `${rarityGlow}1A` }}
      >
        <MinerIcon
          level={template.level}
          rarity={template.rarity}
          className="h-6 w-6 drop-shadow-[0_0_6px_currentColor]"
        />
        {!isAtCap && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background bg-neon-green shadow-[0_0_5px_rgba(52,211,153,0.9)] animate-pulse [animation-duration:1.8s]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{template.name}</p>
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-neon-green">
            LV.{template.level}
          </span>
          {!isAtCap && (
            <span className="ms-auto flex shrink-0 items-center gap-1 rounded-full bg-neon-green/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neon-green">
              <span className="h-1 w-1 rounded-full bg-neon-green" />
              {t.farm.liveLabel}
            </span>
          )}
        </div>
        <p className="truncate text-[10px] text-slate-500">{rarityLabel}</p>

        <div className="mt-1 flex items-center gap-1 font-mono text-[11px] font-semibold tabular-nums text-neon-green">
          <Zap size={10} fill="currentColor" />
          +
          {formatNumber(language, template.hash_per_second * gpu.amount * 3600, {
            maximumFractionDigits: 2,
          })}{" "}
          {t.farm.hashPerHourSuffix}
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-slate-600">
            {t.farm.unitsLabel}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.6)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Ресурс "життя" картки (lifecycle-кап, 1.25× вартості) — окремо від
            прогресу володіння вище: жовтий, щоб не плутати з ним. */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-slate-600">
            {t.farm.resourceLabel}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 shadow-[0_0_6px_rgba(251,191,36,0.5)] transition-all"
              style={{ width: `${lifecycleProgress}%` }}
            />
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-slate-500">
          <Clock size={10} className="shrink-0" />
          {t.farm.uptime}: {formatElapsed(uptimeSeconds)}
        </div>
      </div>

      <ChevronRight size={16} className="shrink-0 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-cyan-400" />
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getRarityLabel(t: TranslationDictionary, rarity: string): string {
  return t.rarity[rarity as keyof TranslationDictionary["rarity"]] ?? rarity;
}

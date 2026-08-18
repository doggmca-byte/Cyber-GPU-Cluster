"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Zap, Gift, Cpu, Bot, Copy, Check, Server, ChevronRight, CirclePlus } from "lucide-react";
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
import { MinerIcon } from "@/components/miners/MinerIcons";

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
  // amount по кожній картці, той самий розрахунок, що виконує harvest_user_hash
  // на бекенді. Рахуємо це, а не беремо profile.hash_balance як базу — інакше
  // великий лічильник показував би загальний баланс і "стрибав" би на нього
  // ж таки після харвесту (баг, знайдений тестуванням на реальному пристрої).
  const initialUnclaimedHash = useMemo(() => {
    const serverTimeMs = new Date(server_time).getTime();
    return user_gpus.reduce((sum, gpu) => {
      if (gpu.amount <= 0) return sum;
      const template = templateByLevel.get(gpu.gpu_level);
      if (!template) return sum;
      const elapsedSeconds = Math.max((serverTimeMs - new Date(gpu.last_harvest_at).getTime()) / 1000, 0);
      return sum + elapsedSeconds * template.hash_per_second * gpu.amount;
    }, 0);
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

  const { unclaimedHash, isHarvesting, harvestError, harvest } = useMiningEngine({
    initialUnclaimedHash,
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

      <TasksEntryButton initData={initData} />

      <MiningPanel
        hashPerHour={hashPerHour}
        unclaimedHash={unclaimedHash}
        isHarvesting={isHarvesting}
        harvestError={harvestError}
        onHarvest={harvest}
      />

      <ActiveServersSection userGpus={user_gpus} templateByLevel={templateByLevel} />
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
    <div className="glass-card flex items-center gap-3 p-4">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-neon-cyan/50 bg-background-card shadow-neon-cyan">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-neon-cyan">
            {initial}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold">{displayName}</p>
        {username && <p className="truncate text-xs text-white/40">@{username}</p>}

        <button
          type="button"
          onClick={() => void copyId()}
          className="mt-0.5 flex items-center gap-1 text-[11px] text-white/30 transition hover:text-white/60"
        >
          ID: {telegramId}
          {copied ? <Check size={11} className="text-neon-green" /> : <Copy size={11} />}
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenDailyBonus}
        className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl border border-neon-gold/30 bg-neon-gold/10 px-3 py-2 transition active:scale-95"
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neon-gold/70">
          {t.farm.dailyBonus}
        </span>
        <span className="flex items-center gap-1 text-xs font-bold text-neon-gold">
          <Gift size={13} />
          {t.tasks.action.claim}
        </span>
      </button>
    </div>
  );
}

function MiningPanel({
  hashPerHour,
  unclaimedHash,
  isHarvesting,
  harvestError,
  onHarvest,
}: {
  hashPerHour: number;
  unclaimedHash: number;
  isHarvesting: boolean;
  harvestError: string | null;
  onHarvest: () => void;
}) {
  const { t, language } = useTranslation();

  return (
    <div className="glass-card flex animate-neon-pulse flex-col items-center gap-3 rounded-3xl px-6 py-7 shadow-neon-cyan">
      <div className="flex w-full items-center justify-between text-white/30">
        <Bot size={22} className="shrink-0 text-neon-cyan/70" />
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/40">
          <span>→</span>
          <span>{t.farm.totalPower}</span>
          <span>←</span>
        </div>
        <Cpu size={20} className="shrink-0 rotate-12 text-neon-green/70" />
      </div>

      <span className="font-display text-lg font-bold text-neon-green drop-shadow-[0_0_10px_rgba(57,255,136,0.5)]">
        +{formatNumber(language, hashPerHour, { maximumFractionDigits: 2 })} {t.farm.hashPerHourSuffix}
      </span>

      <span className="text-[11px] uppercase tracking-widest text-white/30">{t.farm.accumulatedHash}</span>

      <span className="font-display text-4xl font-extrabold tabular-nums text-neon-cyan drop-shadow-[0_0_18px_rgba(34,211,238,0.55)]">
        {formatNumber(language, unclaimedHash, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })}
      </span>
      <span className="-mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
        {t.common.hash}
      </span>

      <button
        type="button"
        onClick={onHarvest}
        disabled={isHarvesting}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-neon-cyan to-neon-green py-3 text-sm font-bold uppercase tracking-wide text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {isHarvesting ? t.farm.harvesting : t.farm.harvestButton}
        {!isHarvesting && <Zap size={16} fill="currentColor" />}
      </button>

      {harvestError && <p className="text-center text-xs text-red-400">{harvestError}</p>}
    </div>
  );
}

function ActiveServersSection({
  userGpus,
  templateByLevel,
}: {
  userGpus: SyncResponse["user_gpus"];
  templateByLevel: Map<number, SyncResponse["gpu_templates"][number]>;
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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">
          <Server size={14} />
          {t.farm.activeServers}
        </div>
        <span className="text-xs font-semibold tabular-nums">
          <span className="text-neon-green">{ownedCount}</span>
          <span className="text-white/30"> / {templateByLevel.size}</span>
        </span>
      </div>

      {userGpus.length === 0 ? (
        <div className="glass-card p-5 text-center text-sm text-white/40">{t.farm.emptyGpuList}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {userGpus.map((gpu) => {
            const template = templateByLevel.get(gpu.gpu_level);
            if (!template) return null;
            return <ServerRow key={gpu.id} gpu={gpu} template={template} now={now} />;
          })}
        </div>
      )}

      <Link
        href="/market"
        className="flex items-center justify-center gap-2 rounded-xl border border-neon-cyan/30 py-2.5 text-xs font-bold uppercase tracking-wide text-neon-cyan transition active:scale-[0.98] hover:bg-neon-cyan/5"
      >
        <CirclePlus size={15} />
        {t.farm.buyNewServer}
      </Link>
    </div>
  );
}

function ServerRow({
  gpu,
  template,
  now,
}: {
  gpu: SyncResponse["user_gpus"][number];
  template: SyncResponse["gpu_templates"][number];
  now: number;
}) {
  const { t, language } = useTranslation();

  const progress = Math.min(gpu.amount / template.max_limit, 1) * 100;
  const rarityLabel = getRarityLabel(t, template.rarity);
  const uptimeSeconds = Math.max((now - new Date(gpu.last_harvest_at).getTime()) / 1000, 0);

  return (
    <div className="glass-card flex items-center gap-3 p-3.5">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-neon-cyan/20 bg-gradient-to-br from-neon-cyan/15 to-neon-purple/10 shadow-neon-cyan">
        <MinerIcon level={template.level} rarity={template.rarity} className="h-7 w-7" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{template.name}</p>
          <span className="shrink-0 rounded-full border border-neon-green/30 bg-neon-green/10 px-1.5 py-0.5 text-[9px] font-bold text-neon-green">
            LV.{template.level}
          </span>
        </div>
        <p className="truncate text-[11px] text-white/35">{rarityLabel}</p>

        <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-neon-green">
          <Zap size={11} fill="currentColor" />
          +
          {formatNumber(language, template.hash_per_second * gpu.amount * 3600, {
            maximumFractionDigits: 2,
          })}{" "}
          {t.farm.hashPerHourSuffix}
        </div>

        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-green"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/30">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-neon-green" />
          {t.farm.uptime}: {formatElapsed(uptimeSeconds)}
        </div>
      </div>

      <ChevronRight size={18} className="shrink-0 text-white/15" />
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

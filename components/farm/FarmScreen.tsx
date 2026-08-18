"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, Gift, Cpu } from "lucide-react";
import { useMiningEngine } from "@/hooks/useMiningEngine";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { formatNumber } from "@/lib/i18n/formatNumber";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { HarvestResponse, SyncResponse } from "@/types/api";
import { ScreenSkeleton, NoTelegramNotice, SyncErrorNotice } from "@/components/ui/ScreenStates";
import { TasksEntryButton } from "@/components/tasks/TasksEntryButton";

export function FarmScreen() {
  const { state } = useUserData();

  if (state.status === "loading") return <ScreenSkeleton />;
  if (state.status === "no-telegram") return <NoTelegramNotice />;
  if (state.status === "error") return <SyncErrorNotice message={state.message} />;

  return <FarmScreenReady data={state.data} initData={state.initData} />;
}

function FarmScreenReady({ data, initData }: { data: SyncResponse; initData: string }) {
  const { t, language } = useTranslation();
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

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard
        displayName={displayName}
        username={profile.username}
        telegramId={profile.telegram_id}
        photoUrl={photoUrl}
      />

      <TasksEntryButton initData={initData} />

      <div className="glass-card flex items-center justify-between px-4 py-2.5 shadow-neon-green">
        <span className="text-xs uppercase tracking-wide text-white/50">{t.farm.totalPower}</span>
        <span className="font-display text-sm font-bold text-neon-green">
          +{formatNumber(language, hashPerHour, { maximumFractionDigits: 2 })} {t.farm.hashPerHourSuffix}
        </span>
      </div>

      <HashCounter
        unclaimedHash={unclaimedHash}
        isHarvesting={isHarvesting}
        harvestError={harvestError}
        onHarvest={harvest}
      />

      <GpuList userGpus={user_gpus} templateByLevel={templateByLevel} />
    </div>
  );
}

function ProfileCard({
  displayName,
  username,
  telegramId,
  photoUrl,
}: {
  displayName: string;
  username: string | null;
  telegramId: number;
  photoUrl?: string;
}) {
  const { t } = useTranslation();
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="glass-card flex items-center gap-3 p-4">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-neon-cyan/40 bg-background-card shadow-neon-cyan">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-neon-cyan">
            {initial}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold">{displayName}</p>
        <p className="truncate text-xs text-white/40">
          {username ? `@${username}` : `ID: ${telegramId}`}
        </p>
      </div>

      <button
        type="button"
        disabled
        title={t.common.comingSoon}
        className="flex shrink-0 items-center gap-1 rounded-full border border-neon-gold/30 bg-neon-gold/10 px-3 py-1.5 text-[11px] font-semibold text-neon-gold opacity-60"
      >
        <Gift size={13} />
        {t.farm.dailyBonus}
      </button>
    </div>
  );
}

function HashCounter({
  unclaimedHash,
  isHarvesting,
  harvestError,
  onHarvest,
}: {
  unclaimedHash: number;
  isHarvesting: boolean;
  harvestError: string | null;
  onHarvest: () => void;
}) {
  const { t, language } = useTranslation();

  return (
    <div className="glass-card flex animate-neon-pulse flex-col items-center gap-4 px-6 py-8 shadow-neon-cyan">
      <div className="flex items-center gap-2 text-white/40">
        <Zap size={14} className="text-neon-cyan" />
        <span className="text-xs uppercase tracking-widest">{t.farm.accumulatedHash}</span>
      </div>

      <span className="font-display text-4xl font-extrabold tabular-nums text-neon-cyan drop-shadow-[0_0_18px_rgba(34,211,238,0.55)]">
        {formatNumber(language, unclaimedHash, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })}
      </span>

      <button
        type="button"
        onClick={onHarvest}
        disabled={isHarvesting}
        className="w-full rounded-2xl bg-gradient-to-r from-neon-cyan to-neon-purple py-3 text-sm font-bold uppercase tracking-wide text-background transition active:scale-[0.98] disabled:opacity-50"
      >
        {isHarvesting ? t.farm.harvesting : t.farm.harvestButton}
      </button>

      {harvestError && <p className="text-center text-xs text-red-400">{harvestError}</p>}
    </div>
  );
}

function GpuList({
  userGpus,
  templateByLevel,
}: {
  userGpus: SyncResponse["user_gpus"];
  templateByLevel: Map<number, SyncResponse["gpu_templates"][number]>;
}) {
  const { t, language } = useTranslation();

  if (userGpus.length === 0) {
    return (
      <div className="glass-card p-5 text-center text-sm text-white/40">{t.farm.emptyGpuList}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {userGpus.map((gpu) => {
        const template = templateByLevel.get(gpu.gpu_level);
        if (!template) return null;

        const progress = Math.min(gpu.amount / template.max_limit, 1) * 100;
        const rarityLabel = getRarityLabel(t, template.rarity);

        return (
          <div key={gpu.id} className="glass-card flex items-center gap-3 p-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan">
              <Cpu size={20} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{template.name}</p>
                <span className="shrink-0 text-xs font-medium text-white/40">
                  {gpu.amount}/{template.max_limit}
                </span>
              </div>

              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/30">
                {rarityLabel} · +
                {formatNumber(language, template.hash_per_second * gpu.amount * 3600, {
                  maximumFractionDigits: 2,
                })}{" "}
                {t.farm.hashPerHourSuffix}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getRarityLabel(t: TranslationDictionary, rarity: string): string {
  return t.rarity[rarity as keyof TranslationDictionary["rarity"]] ?? rarity;
}

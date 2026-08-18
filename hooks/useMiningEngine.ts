"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HarvestResponse } from "@/types/api";

interface UseMiningEngineOptions {
  /**
   * Скільки $HASH уже накопичено, але ще НЕ забрано, НА МОМЕНТ serverTime —
   * викликач рахує це як суму (server_time - gpu.last_harvest_at) *
   * hash_per_second * amount по всіх картках (той самий розрахунок, що
   * виконує harvest_user_hash на бекенді). НЕ загальний hash_balance —
   * саме тому лічильник більше не "стрибає" на весь баланс при харвесті.
   */
  initialUnclaimedHash: number;
  /** Сумарна швидкість видобутку, HASH/сек, з усіх куплених GPU. */
  totalHashPerSecond: number;
  /** server_time (ISO), для якого порахований initialUnclaimedHash. */
  serverTime: string;
  /** Сирий Telegram initData для запиту /api/farm/harvest. */
  initData: string;
  /**
   * Викликається одразу після успішного /api/farm/harvest із повною
   * відповіддю бекенду — щоб caller пропатчив глобальний UserDataProvider
   * (Header має побачити нові hash_balance/game_balance/withdrawable_balance
   * миттєво, без очікування наступного повного /api/user/sync).
   */
  onHarvestSuccess?: (data: HarvestResponse) => void;
}

interface UseMiningEngineResult {
  /**
   * Скільки $HASH накопичено з моменту ОСТАННЬОГО харвесту. Росте з
   * initialUnclaimedHash (а не з 0 сліпо — враховує "офлайн"-бекграунд,
   * якщо застосунок був закритий якийсь час), скидається в 0 одразу
   * після успішного harvest(). Це НЕ загальний баланс користувача.
   */
  unclaimedHash: number;
  isHarvesting: boolean;
  harvestError: string | null;
  /** Оптимістично заморожує лічильник і відправляє /api/farm/harvest. */
  harvest: () => Promise<void>;
}

/**
 * Zero-lag Mining Engine.
 *
 * unclaimed = baselineUnclaimed + (now - baselineClientMs) * hashPerSecond.
 *
 * Рахується локально на requestAnimationFrame без жодних запитів до БД —
 * baselineUnclaimed щоразу приходить від викликача, порахований зі свіжих
 * server_time/last_harvest_at (а не встановлюється рівним нулю при кожному
 * монтуванні) — інакше після довгої відсутності лічильник почав би рахувати
 * з нуля, а на harvest() стрибнув би на реальну (більшу) суму, щойно
 * пораховану сервером, що й було першопричиною бага "хаотичного стрибка".
 */
export function useMiningEngine({
  initialUnclaimedHash,
  totalHashPerSecond,
  serverTime,
  initData,
  onHarvestSuccess,
}: UseMiningEngineOptions): UseMiningEngineResult {
  const baselineUnclaimedRef = useRef(initialUnclaimedHash);
  const baselineClientMsRef = useRef(Date.now());
  const hashPerSecondRef = useRef(totalHashPerSecond);
  const frameRef = useRef<number | null>(null);

  const [unclaimedHash, setUnclaimedHash] = useState(initialUnclaimedHash);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  const tick = useCallback(() => {
    const elapsedSeconds = Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0);
    setUnclaimedHash(baselineUnclaimedRef.current + elapsedSeconds * hashPerSecondRef.current);
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [tick]);

  const setBaseline = useCallback((unclaimed: number, serverTimeIso: string) => {
    // serverTimeIso сам собою не потрібен у розрахунку "тепер" — важлива лише
    // клієнтська точка старту відліку, синхронізована в момент отримання
    // цього значення (баланс годинників клієнт/сервер тут не змішуються).
    void serverTimeIso;
    baselineUnclaimedRef.current = unclaimed;
    baselineClientMsRef.current = Date.now();
    setUnclaimedHash(unclaimed);
  }, []);

  const setHashPerSecond = useCallback((value: number) => {
    const elapsedSeconds = Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0);
    baselineUnclaimedRef.current += elapsedSeconds * hashPerSecondRef.current;
    baselineClientMsRef.current = Date.now();
    hashPerSecondRef.current = value;
  }, []);

  // Ініціалізація/ресинк точки відліку при зміні вхідних даних з сервера
  // (напр. після повторного /api/user/sync).
  useEffect(() => {
    setBaseline(initialUnclaimedHash, serverTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUnclaimedHash, serverTime]);

  // ВАЖЛИВО: змінювати ставку лише через setHashPerSecond (ребейзить baseline),
  // а не прямим присвоєнням hashPerSecondRef.current — інакше на наступному тіку
  // нова ставка заднім числом застосується до ВЖЕ минулого проміжку часу і
  // лічильник "стрибне" вгору/вниз (напр. після купівлі GPU на іншому екрані).
  useEffect(() => {
    setHashPerSecond(totalHashPerSecond);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalHashPerSecond]);

  const harvest = useCallback(async () => {
    if (isHarvesting) return;

    setIsHarvesting(true);
    setHarvestError(null);

    // Оптимістичний UI: одразу заморожуємо поточне незабране значення
    // (rate -> 0), щоб лічильник не "стрибав" під час запиту.
    const optimisticUnclaimed =
      baselineUnclaimedRef.current +
      Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0) * hashPerSecondRef.current;
    const previousRate = hashPerSecondRef.current;

    baselineUnclaimedRef.current = optimisticUnclaimed;
    baselineClientMsRef.current = Date.now();
    hashPerSecondRef.current = 0;
    setUnclaimedHash(optimisticUnclaimed);

    try {
      const res = await fetch("/api/farm/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `harvest failed with status ${res.status}`);
      }

      const data = (await res.json()) as HarvestResponse;
      hashPerSecondRef.current = previousRate;
      // Сервер щойно перевів усе незабране в hash_balance і скинув
      // last_harvest_at на цей момент для кожної картки — нова точка
      // відліку рівно 0, а не data.hash_balance (це і був баг).
      setBaseline(0, data.server_time);
      onHarvestSuccess?.(data);
    } catch (err) {
      hashPerSecondRef.current = previousRate;
      setHarvestError(err instanceof Error ? err.message : "unknown harvest error");
    } finally {
      setIsHarvesting(false);
    }
  }, [initData, isHarvesting, setBaseline, onHarvestSuccess]);

  return { unclaimedHash, isHarvesting, harvestError, harvest };
}

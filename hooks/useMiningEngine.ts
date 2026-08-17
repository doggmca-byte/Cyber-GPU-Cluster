"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HarvestResponse } from "@/types/api";

interface UseMiningEngineOptions {
  /** Останній підтверджений сервером hash_balance (з /api/user/sync або /api/farm/harvest). */
  initialHashBalance: number;
  /** Сумарна швидкість видобутку, HASH/сек, з усіх куплених GPU. */
  totalHashPerSecond: number;
  /** server_time (ISO), що відповідає моменту initialHashBalance — точка відліку. */
  serverTime: string;
  /** Сирий Telegram initData для запиту /api/farm/harvest. */
  initData: string;
}

interface UseMiningEngineResult {
  /** Накопичений $HASH, що плавно росте щокадру (60 FPS через requestAnimationFrame). */
  accumulatedHash: number;
  isHarvesting: boolean;
  harvestError: string | null;
  /** Оптимістично заморожує лічильник і відправляє /api/farm/harvest. */
  harvest: () => Promise<void>;
  /** Ресинк точки відліку (напр. після зовнішньої зміни балансу). */
  setBaseline: (hashBalance: number, serverTimeIso: string) => void;
  /** Зміна швидкості видобутку без "стрибка" вже накопиченого значення. */
  setHashPerSecond: (value: number) => void;
}

/**
 * Zero-lag Mining Engine.
 *
 * Формула: accumulated = baselineHash + (now - baselineServerTime) * hashPerSecond.
 *
 * Рахується локально на requestAnimationFrame без жодних запитів до БД —
 * лише сервер (server_time з відповідей API) є джерелом правди для baseline,
 * тому дрейф годинника клієнта не впливає на коректність суми.
 */
export function useMiningEngine({
  initialHashBalance,
  totalHashPerSecond,
  serverTime,
  initData,
}: UseMiningEngineOptions): UseMiningEngineResult {
  const baselineHashRef = useRef(initialHashBalance);
  const baselineClientMsRef = useRef(Date.now());
  const hashPerSecondRef = useRef(totalHashPerSecond);
  const frameRef = useRef<number | null>(null);

  const [accumulatedHash, setAccumulatedHash] = useState(initialHashBalance);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  const tick = useCallback(() => {
    const elapsedSeconds = Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0);
    setAccumulatedHash(baselineHashRef.current + elapsedSeconds * hashPerSecondRef.current);
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [tick]);

  const setBaseline = useCallback((hashBalance: number, serverTimeIso: string) => {
    // baselineServerTime сам собою не потрібен у розрахунку "тепер" — важлива лише
    // клієнтська точка старту відліку, синхронізована в момент отримання server_time.
    void serverTimeIso;
    baselineHashRef.current = hashBalance;
    baselineClientMsRef.current = Date.now();
    setAccumulatedHash(hashBalance);
  }, []);

  const setHashPerSecond = useCallback((value: number) => {
    const elapsedSeconds = Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0);
    baselineHashRef.current += elapsedSeconds * hashPerSecondRef.current;
    baselineClientMsRef.current = Date.now();
    hashPerSecondRef.current = value;
  }, []);

  // Ініціалізація/ресинк точки відліку при зміні вхідних даних з сервера
  // (напр. після повторного /api/user/sync).
  useEffect(() => {
    setBaseline(initialHashBalance, serverTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHashBalance, serverTime]);

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

    // Оптимістичний UI: одразу заморожуємо поточне накопичене значення
    // (rate -> 0), щоб лічильник не "стрибав" під час запиту.
    const optimisticHash = baselineHashRef.current +
      Math.max((Date.now() - baselineClientMsRef.current) / 1000, 0) * hashPerSecondRef.current;
    const previousRate = hashPerSecondRef.current;

    baselineHashRef.current = optimisticHash;
    baselineClientMsRef.current = Date.now();
    hashPerSecondRef.current = 0;
    setAccumulatedHash(optimisticHash);

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
      setBaseline(data.hash_balance, data.server_time);
    } catch (err) {
      hashPerSecondRef.current = previousRate;
      setHarvestError(err instanceof Error ? err.message : "unknown harvest error");
    } finally {
      setIsHarvesting(false);
    }
  }, [initData, isHarvesting, setBaseline]);

  return { accumulatedHash, isHarvesting, harvestError, harvest, setBaseline, setHashPerSecond };
}

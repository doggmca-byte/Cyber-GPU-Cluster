"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GpuTemplate, HarvestResponse, UserGpu } from "@/types/api";
import { calcUnclaimedHash } from "@/lib/farm/unclaimedHash";

// Захист від "вічно висячого" fetch: без нього кнопка лишилась би на
// "Збираємо..." назавжди, якщо сервер прийняв з'єднання й мовчить.
const HARVEST_TIMEOUT_MS = 15_000;

interface UseMiningEngineOptions {
  /** user_gpus з глобального стейту — ЄДИНЕ джерело last_harvest_at/lifetime/is_dead. */
  userGpus: readonly UserGpu[];
  gpuTemplates: readonly GpuTemplate[];
  /**
   * Різниця "годинник сервера - годинник пристрою", мс (див. UserDataProvider).
   * last_harvest_at пише БД, тож "зараз" для нього = Date.now() + clockOffsetMs.
   */
  clockOffsetMs: number;
  /** Сирий Telegram initData для запиту /api/farm/harvest. */
  initData: string;
  /**
   * Викликається одразу після успішного збору з повною відповіддю бекенду —
   * caller кладе її в глобальний стейт (баланси, user_gpus, годинник) РІВНО
   * такою, якою її повернув сервер.
   */
  onHarvestSuccess: (data: HarvestResponse) => void;
  /**
   * Збір не вдався (мережа/таймаут/5xx). Відповідь могла загубитись ПІСЛЯ того,
   * як сервер уже зарахував HASH, тож caller тихо пересинхронізує стан з БД.
   */
  onHarvestFailure?: () => void;
}

interface UseMiningEngineResult {
  /**
   * Скільки $HASH накопичено й ще НЕ зібрано. Це не окрема змінна з власною
   * "базою", а щокадрова функція від user_gpus і поточного часу — тому після
   * (пере)монтування екрана вона завжди збігається з тим, що нарахує сервер.
   */
  unclaimedHash: number;
  /** true, коли хоч одна жива картка впирається в кап накопичення. */
  isAtCap: boolean;
  isHarvesting: boolean;
  harvestError: string | null;
  /** Блокує кнопку, заморожує лічильник на час запиту й відправляє /api/farm/harvest. */
  harvest: () => Promise<void>;
}

/**
 * Zero-lag Mining Engine.
 *
 * unclaimed = Σ по картках min(elapsed * hash_per_second * amount, headroom),
 * elapsed = (Date.now() + clockOffset - last_harvest_at), обмежений 12 годинами
 * (calcUnclaimedHash — дзеркало harvest_user_hash).
 *
 * Жодного локального "baseline": раніше він жив у useRef і скидався на 0 лише в
 * межах одного монтування, тож після переходу на іншу вкладку й назад
 * компонент рахував зі СТАРИХ last_harvest_at і повертав уже зібрану суму. Тепер
 * стан — тільки user_gpus у глобальному сховищі, яке оновлює відповідь сервера.
 *
 * Тікер — requestAnimationFrame; знімається в cleanup ефекту (розмонтування
 * або зміна вхідних даних), тож витоків немає. У фоновій вкладці rAF
 * призупиняється сам, а при поверненні перший же кадр рахує від Date.now().
 */
export function useMiningEngine({
  userGpus,
  gpuTemplates,
  clockOffsetMs,
  initData,
  onHarvestSuccess,
  onHarvestFailure,
}: UseMiningEngineOptions): UseMiningEngineResult {
  const templateByLevel = useMemo(() => new Map(gpuTemplates.map((tmpl) => [tmpl.level, tmpl])), [gpuTemplates]);

  // Початкове значення рахуємо одразу — без спалаху 0 / застарілого числа на
  // першому кадрі після монтування.
  const [snapshot, setSnapshot] = useState(() =>
    calcUnclaimedHash(userGpus, templateByLevel, Date.now() + clockOffsetMs),
  );
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  // ref, а не лише state: два кліки в межах одного тіку рендера обидва бачили б
  // isHarvesting === false із замикання й відправили б два запити.
  const harvestingRef = useRef(false);
  // Масив user_gpus, який ВЖЕ замінений відповіддю збору: тік зі старого
  // замикання (rAF між setState і комітом) не має права повернути стару суму.
  const supersededGpusRef = useRef<readonly UserGpu[] | null>(null);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      if (!harvestingRef.current && supersededGpusRef.current !== userGpus) {
        const next = calcUnclaimedHash(userGpus, templateByLevel, Date.now() + clockOffsetMs);
        // 4 знаки після коми — саме стільки показує UI; не перерендерюємо ферму
        // на кожен кадр, якщо видиме число не змінилось.
        setSnapshot((prev) =>
          prev.isAtCap === next.isAtCap && Math.round(prev.unclaimed * 1e4) === Math.round(next.unclaimed * 1e4)
            ? prev
            : next,
        );
      }
      frame = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(frame);
  }, [userGpus, templateByLevel, clockOffsetMs]);

  const harvest = useCallback(async () => {
    if (harvestingRef.current) return;
    harvestingRef.current = true;
    setIsHarvesting(true);
    setHarvestError(null);

    // Лічильник на час запиту просто заморожений (тік пропускається) — він
    // НЕ обнуляється: якщо збір не вдасться, користувач не "втрачає" суму.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HARVEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/farm/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `harvest failed with status ${res.status}`);
      }

      const data = (await res.json()) as HarvestResponse;

      // Лічильник одразу стає тим, що випливає з ВІДПОВІДІ сервера (≈ 0), і
      // старий масив user_gpus більше не тікає, поки новий не дійде в стейт.
      supersededGpusRef.current = userGpus;
      setSnapshot(calcUnclaimedHash(data.user_gpus, templateByLevel, Date.parse(data.server_time)));
      onHarvestSuccess(data);
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      setHarvestError(
        isTimeout
          ? "request timed out — server took too long to respond"
          : err instanceof Error
            ? err.message
            : "unknown harvest error",
      );
      onHarvestFailure?.();
    } finally {
      clearTimeout(timeoutId);
      harvestingRef.current = false;
      setIsHarvesting(false);
    }
  }, [initData, userGpus, templateByLevel, onHarvestSuccess, onHarvestFailure]);

  return { unclaimedHash: snapshot.unclaimed, isAtCap: snapshot.isAtCap, isHarvesting, harvestError, harvest };
}

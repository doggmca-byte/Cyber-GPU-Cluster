import type { GpuTemplate, UserGpu } from "@/types/api";
import { MAX_UNCLAIMED_SECONDS, gpuLifecycleCapHash } from "@/lib/constants/economy";

export interface UnclaimedHashSnapshot {
  /** Скільки $HASH накопичено й ще не зібрано на момент serverNowMs. */
  unclaimed: number;
  /**
   * true, коли хоч одна жива картка впирається в кап (12 год без збору або
   * lifecycle-ліміт) — ферма показує "виробництво призупинено".
   */
  isAtCap: boolean;
}

/**
 * Дзеркало harvest_user_hash: для кожної живої картки
 *   min( clamp(now - last_harvest_at, 0, 12h) * hash_per_second * amount,
 *        lifecycle_cap - lifetime_hash_generated ).
 *
 * Це ЧИСТА функція від (user_gpus, шаблони, поточний час сервера): жодного
 * власного "базового" значення, яке можна забути скинути. Тому єдиним джерелом
 * правди є user_gpus у глобальному стейті — після збору він оновлюється
 * відповіддю сервера, і будь-який (пере)змонтований компонент одразу
 * показує правильну суму.
 *
 * serverNowMs = Date.now() + clockOffsetMs, де clockOffsetMs — різниця
 * "годинник сервера - годинник пристрою" (див. UserDataProvider): last_harvest_at
 * пише БД, тож порівнювати його з годинником пристрою напряму не можна.
 */
export function calcUnclaimedHash(
  userGpus: readonly UserGpu[],
  templateByLevel: ReadonlyMap<number, GpuTemplate>,
  serverNowMs: number,
): UnclaimedHashSnapshot {
  let unclaimed = 0;
  let isAtCap = false;

  for (const gpu of userGpus) {
    // Мертві картки сервер пропускає (continue) — не нараховують і не рахуємо.
    if (gpu.amount <= 0 || gpu.is_dead) continue;

    const template = templateByLevel.get(gpu.gpu_level);
    if (!template) continue;

    const lastHarvestMs = Date.parse(gpu.last_harvest_at);
    if (Number.isNaN(lastHarvestMs)) continue;

    const elapsedSeconds = Math.min(Math.max((serverNowMs - lastHarvestMs) / 1000, 0), MAX_UNCLAIMED_SECONDS);
    const accruedByTime = elapsedSeconds * template.hash_per_second * gpu.amount;

    const headroom = Math.max(gpuLifecycleCapHash(template.cost_ton, gpu.amount) - gpu.lifetime_hash_generated, 0);

    unclaimed += Math.min(accruedByTime, headroom);
    if (elapsedSeconds >= MAX_UNCLAIMED_SECONDS || accruedByTime >= headroom) isAtCap = true;
  }

  return { unclaimed, isAtCap };
}

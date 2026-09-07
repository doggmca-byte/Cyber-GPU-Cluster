import type { GpuTemplate, UserGpu } from "@/types/api";

/**
 * Сумарна швидкість видобутку з усіх куплених карток.
 *
 * Мертві (is_dead) картки не виробляють нічого, доки не оживлені — той самий
 * принцип, що й у harvest_user_hash на бекенді (continue для is_dead рядків).
 *
 * Спільна реалізація для /api/user/sync і /api/farm/buy: обидва роути мусять
 * повертати ОДНЕ Й ТЕ САМЕ число для одного й того самого стану БД. Раніше
 * формула жила лише в sync, а після покупки клієнт добудовував потужність
 * сам, інкрементом — і будь-яка розбіжність між цими двома шляхами давала
 * розсинхрон "шапка/ферма показують не те, що в базі".
 */
export function calcTotalHashPerSecond(userGpus: UserGpu[], gpuTemplates: GpuTemplate[]): number {
  const templateByLevel = new Map(gpuTemplates.map((t) => [t.level, t]));

  return userGpus.reduce((sum, gpu) => {
    if (gpu.is_dead) return sum;
    const template = templateByLevel.get(gpu.gpu_level);
    return sum + (template ? template.hash_per_second * gpu.amount : 0);
  }, 0);
}

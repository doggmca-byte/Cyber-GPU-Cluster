import { ADSGRAM_DAILY_CAP } from "@/lib/constants/economy";

/**
 * Клієнтський лічильник реклами AdsGram за добу UTC (ADSGRAM_DAILY_CAP).
 * Серверне значення приходить з /api/user/sync (adsgram_today), а між
 * синками кожен показ додає +1 локально — щоб вимкнення спрацювало одразу,
 * не чекаючи постбеку. Беремо більше з двох, щоб запізнілий sync не скинув
 * свіжі локальні покази. Коли ліміт вичерпано, AdsGram для цього гравця
 * поводиться як мережа без реклами — і застосунок іде до наступної за
 * звичним порядком (GigaPub).
 */
const STORAGE_KEY = "cgc_adsgram_shown_today";

type DayCount = { date: string; count: number };

let memory: DayCount | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function read(): DayCount {
  if (!memory && typeof window !== "undefined") {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as DayCount | null;
      if (parsed && typeof parsed.date === "string" && Number.isFinite(parsed.count)) memory = parsed;
    } catch {
      // localStorage недоступний — рахуємо лише в пам'яті, сервер однаково тримає ліміт.
    }
  }
  return memory && memory.date === today() ? memory : { date: today(), count: 0 };
}

function write(next: DayCount): void {
  memory = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // див. read()
  }
}

/** Значення з сервера (/api/user/sync). */
export function syncAdsgramShownToday(serverCount: number): void {
  if (typeof window === "undefined" || !Number.isFinite(serverCount)) return;
  write({ date: today(), count: Math.max(serverCount, read().count) });
}

/** +1 після кожного показу/виконаного завдання AdsGram. */
export function noteAdsgramShown(): void {
  if (typeof window === "undefined") return;
  write({ date: today(), count: read().count + 1 });
}

export function isAdsgramCapped(): boolean {
  if (typeof window === "undefined") return false;
  return read().count >= ADSGRAM_DAILY_CAP;
}

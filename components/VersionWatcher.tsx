"use client";

import { useEffect } from "react";

/**
 * Скільки застосунок має пробути згорнутим, щоб при поверненні ми його
 * перезапустили навіть без нового деплою.
 *
 * Причина — Monetag: він відмовляється показувати рекламу в "занадто довгій
 * сесії" і сам просить гравця перезапустити застосунок. А Mini App у Telegram
 * саме так і живе — годинами у фоні. Після півгодинної паузи тихий
 * перезапуск коштує гравцеві один сплеш-екран, зате реклама щоденного бонусу
 * знову працює, а баланси підтягуються свіжі.
 */
const STALE_AFTER_HIDDEN_MS = 30 * 60 * 1000;

/** Захист від петлі: не перезавантажуємось частіше, ніж раз на дві хвилини. */
const RELOAD_COOLDOWN_MS = 2 * 60 * 1000;
const LAST_RELOAD_KEY = "cgc_version_reload_at";

function reloadedRecently(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(LAST_RELOAD_KEY));
    return Number.isFinite(at) && Date.now() - at < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function reload() {
  if (reloadedRecently()) return;
  try {
    window.sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage недоступний — перезавантажуємось без запобіжника
  }
  window.location.reload();
}

async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const { build_id } = (await res.json()) as { build_id: string | null };
    return build_id ?? null;
  } catch {
    // Мережевий збій — не привід перезавантажувати: перевіримо наступного разу.
    return null;
  }
}

/**
 * Перезапускає застосунок у момент повернення гравця з фону, якщо:
 *   - з часу відкриття сторінки вийшов новий деплой (інакше він крутив би
 *     старий код — саме так Monetag "з'являвся" там, звідки його вже прибрали);
 *   - або застосунок пробув згорнутим довше за STALE_AFTER_HIDDEN_MS.
 *
 * Версію сторінки не вшиваємо в бандл, а запам'ятовуємо з сервера при старті:
 * Next збирає клієнт і сервер окремими проходами, тож "вшите" значення на
 * клієнті й серверне розходились би навіть у межах одного деплою.
 *
 * Перевірка — лише на поверненні з фону, ніколи посеред дії: людина, що
 * дивиться рекламу чи підтверджує вивід, перезапуску не отримає.
 */
export function VersionWatcher() {
  useEffect(() => {
    let bootBuild: string | null = null;
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;

    void fetchServerBuild().then((id) => {
      bootBuild = id;
    });

    const onVisibilityChange = async () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }

      const wasHiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;

      if (wasHiddenFor >= STALE_AFTER_HIDDEN_MS) {
        reload();
        return;
      }

      if (!bootBuild) return;
      const current = await fetchServerBuild();
      if (current && current !== bootBuild) reload();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return null;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getWebAppInitData } from "@/lib/telegram/getWebAppInitData";
import type { BuyGpuResponse, Profile, SyncResponse } from "@/types/api";

export type UserDataState =
  | { status: "loading" }
  | { status: "no-telegram" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SyncResponse; initData: string };

interface UserDataContextValue {
  state: UserDataState;
  /** Повний ресинк із /api/user/sync (напр. після referral-claim чи pull-to-refresh). */
  refresh: () => Promise<void>;
  /** Оптимістичний локальний патч полів профілю (баланси/квота) без round-trip. */
  patchProfile: (patch: Partial<Profile>) => void;
  /** Оптимістична зміна кількості конкретного рівня GPU (+1 при купівлі тощо). */
  /**
   * Застосовує РЕЗУЛЬТАТ успішної покупки: масив обладнання, потужність і
   * баланси беруться з відповіді бекенду як є. Жодних оптимістичних дельт —
   * саме вони й давали "фантомні сервери" з +0 HASH/год, коли покупка
   * падала через нестачу коштів (відкат лишав рядок з amount = 0).
   */
  applyGpuPurchase: (result: BuyGpuResponse) => void;
  /** Патч після успішного revive_gpu — оживлює рядок і списує game_balance разом. */
  patchGpuRevived: (level: number, newGameBalance: number, revivalCount: number) => void;
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UserDataState>({ status: "loading" });
  const initDataRef = useRef<string | null>(null);

  const sync = useCallback(async () => {
    // Скидаємо на "loading" ЩОРАЗУ на початку виклику (не лише початкове
    // значення useState) — інакше повторний sync() після помилки (IntroLoader
    // "Спробувати знову" → refresh()) лишав би стан "error" протягом усього
    // нового запиту: підписники (IntroLoader, SyncErrorNotice) бачили б
    // застарілу помилку замість skeleton, і IntroLoader міг би миттю знову
    // зафейлитись, ще не дочекавшись реальної відповіді нового fetch.
    setState({ status: "loading" });

    const initData = initDataRef.current ?? getWebAppInitData();

    if (!initData) {
      setState({ status: "no-telegram" });
      return;
    }
    initDataRef.current = initData;

    // AbortController-таймаут — захист від "вічно висячого" fetch (сервер
    // приймає з'єднання, але ніколи не відповідає): без цього проміс sync()
    // не резолвився б і не реджектився б ніколи, і UserDataProvider завис би
    // в "loading" назавжди. IntroLoader має власний незалежний fail-safe
    // (7.5с) для UX, але цей таймаут ще й звільняє сам зависаючий запит.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `sync failed with status ${res.status}`);
      }

      const data = (await res.json()) as SyncResponse;
      setState({ status: "ready", data, initData });
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      setState({
        status: "error",
        message: isTimeout
          ? "request timed out — server took too long to respond"
          : err instanceof Error
            ? err.message
            : "unknown sync error",
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    void sync();
  }, [sync]);

  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        ...prev,
        data: { ...prev.data, profile: { ...prev.data.profile, ...patch } },
      };
    });
  }, []);

  const applyGpuPurchase = useCallback((result: BuyGpuResponse) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;

      // hash_balance рахуємо від АКТУАЛЬНОГО значення в стані (prev), а не від
      // того, яке компонент захопив у замикання на момент кліку: між кліком і
      // відповіддю баланс міг змінити будь-який інший флоу (харвест, нагорода
      // за завдання, реклама), і запис захопленого значення затер би його.
      const profile = {
        ...prev.data.profile,
        game_balance: result.new_game_balance,
        hash_balance: prev.data.profile.hash_balance + result.hash_harvested,
      };

      // user_gpus і потужність — рівно те, що повернув бекенд після успішної
      // транзакції (buy_gpu спершу харвестить усі картки й скидає їм
      // last_harvest_at, тож свіжі рядки з БД уже містять правильний час, і
      // useMiningEngine не порахує вже враховану ділянку часу вдруге).
      return {
        ...prev,
        data: {
          ...prev.data,
          profile,
          user_gpus: result.user_gpus,
          total_hash_per_second: result.total_hash_per_second,
        },
      };
    });
  }, []);

  const patchGpuRevived = useCallback((level: number, newGameBalance: number, revivalCount: number) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;

      const now = new Date().toISOString();
      const nextUserGpus = prev.data.user_gpus.map((g) =>
        g.gpu_level === level
          ? { ...g, is_dead: false, lifetime_hash_generated: 0, last_harvest_at: now, revival_count: revivalCount }
          : g,
      );

      return {
        ...prev,
        data: {
          ...prev.data,
          user_gpus: nextUserGpus,
          profile: { ...prev.data.profile, game_balance: newGameBalance },
        },
      };
    });
  }, []);

  const value = useMemo<UserDataContextValue>(
    () => ({ state, refresh: sync, patchProfile, applyGpuPurchase, patchGpuRevived }),
    [state, sync, patchProfile, applyGpuPurchase, patchGpuRevived],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData(): UserDataContextValue {
  const ctx = useContext(UserDataContext);
  if (!ctx) {
    throw new Error("useUserData must be used within <UserDataProvider>");
  }
  return ctx;
}

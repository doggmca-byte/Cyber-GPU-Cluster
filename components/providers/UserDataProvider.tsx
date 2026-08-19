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
import type { Profile, SyncResponse } from "@/types/api";

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
  patchUserGpuAmount: (level: number, amountDelta: number) => void;
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

  const patchUserGpuAmount = useCallback((level: number, amountDelta: number) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;

      const now = new Date().toISOString();
      const existing = prev.data.user_gpus.find((g) => g.gpu_level === level);

      // buy_gpu на бекенді ЗАВЖДИ спершу харвестить УСІ наявні картки (щоб
      // зафіксувати дохід до зміни amount) — тобто last_harvest_at усіх рядків
      // на сервері вже скинуто на "зараз". Синхронізуємо це й тут локально,
      // інакше useMiningEngine на Farm після повернення з Market порахує вже
      // враховану сервером ділянку часу ЩЕ РАЗ як "незабрану".
      const resetGpus = prev.data.user_gpus.map((g) => ({ ...g, last_harvest_at: now }));

      const nextUserGpus = existing
        ? resetGpus.map((g) =>
            g.gpu_level === level ? { ...g, amount: g.amount + amountDelta } : g,
          )
        : [
            ...resetGpus,
            {
              id: `optimistic-${level}-${Date.now()}`,
              user_id: prev.data.profile.id,
              gpu_level: level,
              amount: amountDelta,
              last_harvest_at: now,
              lifetime_hash_generated: 0,
              is_dead: false,
              revival_count: 0,
            },
          ];

      const template = prev.data.gpu_templates.find((t) => t.level === level);
      const total_hash_per_second =
        prev.data.total_hash_per_second +
        (template ? template.hash_per_second * amountDelta : 0);

      return {
        ...prev,
        data: { ...prev.data, user_gpus: nextUserGpus, total_hash_per_second },
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
    () => ({ state, refresh: sync, patchProfile, patchUserGpuAmount, patchGpuRevived }),
    [state, sync, patchProfile, patchUserGpuAmount, patchGpuRevived],
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

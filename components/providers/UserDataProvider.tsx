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
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UserDataState>({ status: "loading" });
  const initDataRef = useRef<string | null>(null);

  const sync = useCallback(async () => {
    const initData = initDataRef.current ?? getWebAppInitData();

    if (!initData) {
      setState({ status: "no-telegram" });
      return;
    }
    initDataRef.current = initData;

    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `sync failed with status ${res.status}`);
      }

      const data = (await res.json()) as SyncResponse;
      setState({ status: "ready", data, initData });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "unknown sync error",
      });
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

      const existing = prev.data.user_gpus.find((g) => g.gpu_level === level);
      const nextUserGpus = existing
        ? prev.data.user_gpus.map((g) =>
            g.gpu_level === level ? { ...g, amount: g.amount + amountDelta } : g,
          )
        : [
            ...prev.data.user_gpus,
            {
              id: `optimistic-${level}-${Date.now()}`,
              user_id: prev.data.profile.id,
              gpu_level: level,
              amount: amountDelta,
              last_harvest_at: new Date().toISOString(),
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

  const value = useMemo<UserDataContextValue>(
    () => ({ state, refresh: sync, patchProfile, patchUserGpuAmount }),
    [state, sync, patchProfile, patchUserGpuAmount],
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

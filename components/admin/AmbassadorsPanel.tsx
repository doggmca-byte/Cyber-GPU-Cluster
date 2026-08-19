"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, UserCheck, UserMinus } from "lucide-react";
import type {
  AdminAmbassadorProfile,
  AdminAmbassadorsListResponse,
  AdminAmbassadorToggleResponse,
} from "@/types/admin";

/**
 * Вкладка "Амбасадори": пошук користувача за telegram_id, перемикач
 * is_ambassador (призначити/зняти) і таблиця вже призначених.
 */
export function AmbassadorsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [telegramIdInput, setTelegramIdInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [found, setFound] = useState<AdminAmbassadorProfile | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const [items, setItems] = useState<AdminAmbassadorProfile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/admin/ambassadors", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }
      const data = (await res.json()) as AdminAmbassadorsListResponse;
      setItems(data.items);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "unknown error");
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const search = async () => {
    const telegramId = Number(telegramIdInput.trim());
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      setSearchError("Вкажи коректний Telegram ID");
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setFound(null);

    try {
      const res = await fetch(`/api/admin/ambassadors/search?telegram_id=${telegramId}`, {
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      setFound((await res.json()) as AdminAmbassadorProfile);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsSearching(false);
    }
  };

  const toggle = async (nextValue: boolean) => {
    if (!found || isToggling) return;

    setIsToggling(true);
    setSearchError(null);

    try {
      const res = await fetch("/api/admin/ambassadors/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: found.telegram_id, is_ambassador: nextValue }),
      });

      if (res.status === 401 || res.status === 403) {
        onSessionExpired();
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `failed with status ${res.status}`);
      }

      const data = (await res.json()) as AdminAmbassadorToggleResponse;
      setFound(data.profile);
      void loadList();
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-3.5">
        <p className="text-xs font-semibold text-white/70">Пошук / призначення амбасадора</p>
        <p className="mt-1 text-[11px] text-white/40">
          Знайди користувача за Telegram ID (профіль має вже існувати — тобто гравець хоча б раз
          відкривав застосунок), тоді призначай або знімай статус амбасадора.
        </p>

        <div className="mt-2.5 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Telegram ID гравця"
            value={telegramIdInput}
            onChange={(e) => setTelegramIdInput(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-white outline-none focus:border-neon-cyan/60"
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={isSearching}
            className="flex items-center gap-1.5 rounded-lg bg-neon-cyan px-3 py-2 text-xs font-semibold text-background transition disabled:opacity-50"
          >
            {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Знайти
          </button>
        </div>

        {searchError && <p className="mt-2 text-[11px] text-red-400">{searchError}</p>}

        {found && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 p-3">
            <div>
              <p className="text-sm font-semibold">{found.username ? `@${found.username}` : (found.first_name ?? "—")}</p>
              <p className="text-[11px] text-white/40">Telegram ID: {found.telegram_id}</p>
              <p className="mt-1 text-[11px]">
                Статус:{" "}
                <span className={found.is_ambassador ? "font-semibold text-neon-green" : "text-white/40"}>
                  {found.is_ambassador ? "Амбасадор" : "Звичайний гравець"}
                </span>
              </p>
            </div>

            {found.is_ambassador ? (
              <button
                type="button"
                onClick={() => void toggle(false)}
                disabled={isToggling}
                className="flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-400 transition disabled:opacity-50"
              >
                <UserMinus size={14} />
                Зняти
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void toggle(true)}
                disabled={isToggling}
                className="flex items-center gap-1.5 rounded-lg bg-neon-green px-3 py-2 text-xs font-semibold text-background transition disabled:opacity-50"
              >
                <UserCheck size={14} />
                Призначити
              </button>
            )}
          </div>
        )}
      </div>

      <div className="glass-card p-3.5">
        <p className="text-xs font-semibold text-white/70">Призначені амбасадори</p>

        {listError && <p className="mt-2 text-[11px] text-red-400">{listError}</p>}

        {items === null && !listError && <p className="mt-2 text-[11px] text-white/40">Завантаження...</p>}

        {items !== null && items.length === 0 && (
          <p className="mt-2 text-[11px] text-white/40">Амбасадорів ще не призначено.</p>
        )}

        {items !== null && items.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {items.map((item) => (
              <div
                key={item.telegram_id}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-[11px]"
              >
                <span className="font-semibold text-white">
                  {item.username ? `@${item.username}` : (item.first_name ?? "—")}
                </span>
                <span className="text-white/40">ID: {item.telegram_id}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

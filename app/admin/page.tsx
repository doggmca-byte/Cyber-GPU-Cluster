"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";
import { getWebAppInitData } from "@/lib/telegram/getWebAppInitData";
import { WithdrawalsPanel } from "@/components/admin/WithdrawalsPanel";

type AuthState =
  | { status: "checking" }
  | { status: "needs-telegram" } // відкрито в звичайному браузері — Сценарій 2 поки не реалізовано
  | { status: "access-denied" }
  | { status: "error"; message: string }
  | { status: "ready" };

/**
 * /admin сама керує своїм auth-станом (middleware.ts гейтить лише API) —
 * жодного окремого /admin/login більше немає.
 *
 * Сценарій 1 (реалізовано): відкрито всередині Telegram — initData
 * доступний одразу (SDK підключений у кореневому app/layout.tsx для всього
 * сайту), автоматично логінимось через /api/admin/telegram-login.
 *
 * Сценарій 2 (звичайний браузер, без initData): свідомо НЕ реалізовано в
 * цьому етапі — показуємо чіткий стан "потрібен Telegram", а не вигадуємо
 * тимчасовий обхідний шлях автентифікації.
 */
export default function AdminPage() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  const attemptAuth = useCallback(async () => {
    setAuth({ status: "checking" });

    const initData = getWebAppInitData();

    if (!initData) {
      setAuth({ status: "needs-telegram" });
      return;
    }

    try {
      const res = await fetch("/api/admin/telegram-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (res.ok) {
        setAuth({ status: "ready" });
        return;
      }

      if (res.status === 403) {
        setAuth({ status: "access-denied" });
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setAuth({ status: "error", message: body?.error ?? `status ${res.status}` });
    } catch (err) {
      setAuth({ status: "error", message: err instanceof Error ? err.message : "unknown error" });
    }
  }, []);

  useEffect(() => {
    void attemptAuth();
  }, [attemptAuth]);

  if (auth.status === "checking") {
    return <CenteredNotice>Перевірка доступу...</CenteredNotice>;
  }

  if (auth.status === "needs-telegram") {
    return (
      <CenteredNotice icon={<Smartphone size={32} className="text-neon-cyan" />} title="Потрібен Telegram">
        Ця адмінка автентифікує лише через Telegram Mini App. Відкрий цю сторінку зсередини Telegram
        (той самий бот/додаток).
      </CenteredNotice>
    );
  }

  if (auth.status === "access-denied") {
    return (
      <CenteredNotice icon={<ShieldAlert size={32} className="text-red-400" />} title="403 Access Denied">
        Your Telegram ID is not authorized.
      </CenteredNotice>
    );
  }

  if (auth.status === "error") {
    return (
      <CenteredNotice icon={<ShieldAlert size={32} className="text-red-400" />} title="Помилка авторизації">
        {auth.message}
      </CenteredNotice>
    );
  }

  return <WithdrawalsPanel onUnauthorized={() => void attemptAuth()} />;
}

function CenteredNotice({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center gap-3 p-8 text-center">
      {icon ?? <ShieldCheck size={32} className="text-white/30" />}
      {title && <p className="font-display text-base font-bold">{title}</p>}
      <p className="text-sm text-white/50">{children}</p>
    </div>
  );
}

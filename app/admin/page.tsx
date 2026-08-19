"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";
import { getWebAppInitData } from "@/lib/telegram/getWebAppInitData";
import { AdminShell } from "@/components/admin/AdminShell";

type AuthState =
  | { status: "checking" }
  | { status: "needs-telegram" } // відкрито в звичайному браузері — Сценарій 2 поки не реалізовано
  | { status: "access-denied" }
  | { status: "error"; message: string }
  | { status: "ready" }
  // Явний стан ПІСЛЯ натискання "Вийти" — НЕ переходить в "checking"/attemptAuth().
  // Fix: раніше кнопка "Вийти" (WithdrawalsPanel.logout) чистила cookie, а тоді
  // одразу викликала той самий onUnauthorized/attemptAuth, що й обробка 401 з API —
  // а він всередині Telegram миттєво перелогінював адміна назад через
  // /api/admin/telegram-login (initData ж лежить в SDK і так, і так), тому клік
  // на "Вийти" візуально не мав жодного ефекту. Тепер логаут — окремий термінальний
  // стан з ЯВНОЮ кнопкою "Увійти знову", а onSessionExpired (401/403 з API-запитів
  // під час роботи) — окремий колбек, що й далі мовчки ретраїть attemptAuth().
  | { status: "logged-out" };

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

  // Викликається лише явним кліком на "Вийти" в AdminShell — чистить cookie і
  // ЗУПИНЯЄТЬСЯ на терміальному стані, жодного авто-релогіну.
  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      setAuth({ status: "logged-out" });
    }
  }, []);

  if (auth.status === "checking") {
    return <CenteredNotice>Перевірка доступу...</CenteredNotice>;
  }

  if (auth.status === "logged-out") {
    return (
      <CenteredNotice icon={<LogIn size={32} className="text-neon-cyan" />} title="Вихід виконано">
        <div className="flex flex-col items-center gap-3">
          <p>Сесію адмінки завершено.</p>
          <button
            type="button"
            onClick={() => void attemptAuth()}
            className="rounded-xl bg-neon-cyan px-4 py-2 text-xs font-semibold text-background transition active:scale-[0.98]"
          >
            Увійти знову
          </button>
        </div>
      </CenteredNotice>
    );
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

  return <AdminShell onSessionExpired={() => void attemptAuth()} onLogout={() => void logout()} />;
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
      <div className="text-sm text-white/50">{children}</div>
    </div>
  );
}

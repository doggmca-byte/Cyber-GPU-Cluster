"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUserData } from "@/components/providers/UserDataProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { isCaptchaFresh } from "@/lib/captcha/policy";

interface Challenge {
  challenge_id: string;
  background: string;
  piece: string;
  width: number;
  height: number;
  piece_size: number;
  start_x: number;
}

type Phase = "loading" | "ready" | "verifying" | "error";

const MAX_PATH_POINTS = 400;

/**
 * Пазл-капча при вході (раз на 24 год). Клієнт лише малює картинки й збирає жест —
 * правильна відповідь є тільки на сервері, а вивід коштів окремо вимагає свіжої
 * верифікації на бекенді (/api/wallet/withdraw), тож обійти цей екран прямим
 * викликом API не вийде.
 */
export function CaptchaGate() {
  const { state, patchProfile } = useUserData();
  const verifiedAt = state.status === "ready" ? state.data.profile.captcha_verified_at : null;
  const initData = state.status === "ready" ? state.initData : null;
  const isReady = state.status === "ready";

  // Раз на хвилину перераховуємо, чи не протухла верифікація посеред сесії.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  void tick; // лише щоб перерахунок нижче виконувався щохвилини
  const needed = isReady && !isCaptchaFresh(verifiedAt);

  if (!needed || !initData) return null;
  return <CaptchaModal initData={initData} onSolved={(at) => patchProfile({ captcha_verified_at: at })} />;
}

function CaptchaModal({ initData, onSolved }: { initData: string; onSolved: (verifiedAt: string) => void }) {
  const { t } = useTranslation();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [pieceX, setPieceX] = useState(0); // центр уламка, логічні px
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startedAt: number; path: Array<[number, number]> } | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (note: string | null) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setPhase("loading");
      setMessage(note);
      try {
        const res = await fetch("/api/captcha/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (res.status === 429) {
          setChallenge(null);
          setMessage(t.captcha.tooMany);
          setPhase("error");
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Challenge;
        setChallenge(data);
        setPieceX(data.start_x);
        setPhase("ready");
      } catch {
        setChallenge(null);
        setMessage(t.captcha.loadFailed);
        setPhase("error");
      } finally {
        loadingRef.current = false;
      }
    },
    [initData, t],
  );

  useEffect(() => {
    void load(null);
    // лише перше завантаження; далі — кнопка "Оновити" / помилка верифікації
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toLogicalX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || !challenge) return pieceX;
    const rect = track.getBoundingClientRect();
    const logical = ((clientX - rect.left) / rect.width) * challenge.width;
    const half = challenge.piece_size / 2;
    return Math.min(challenge.width - half, Math.max(challenge.start_x, logical));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== "ready" || !challenge) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    dragRef.current = { startedAt: now, path: [[challenge.start_x, 0]] };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || phase !== "ready") return;
    const x = toLogicalX(event.clientX);
    setPieceX(x);
    if (drag.path.length < MAX_PATH_POINTS) {
      drag.path.push([Math.round(x * 100) / 100, Math.round(performance.now() - drag.startedAt)]);
    }
  };

  const onPointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !challenge || phase !== "ready") return;

    const x = toLogicalX(event.clientX);
    setPieceX(x);
    drag.path.push([Math.round(x * 100) / 100, Math.round(performance.now() - drag.startedAt)]);

    setPhase("verifying");
    setMessage(null);
    try {
      const res = await fetch("/api/captcha/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData,
          challenge_id: challenge.challenge_id,
          x: Math.round(x * 100) / 100,
          path: drag.path,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { verified_at: string };
        onSolved(data.verified_at);
        return;
      }
      // Пазл "спалений" після спроби — одразу даємо новий.
      loadingRef.current = false;
      await load(res.status === 429 ? t.captcha.tooMany : t.captcha.wrong);
    } catch {
      loadingRef.current = false;
      await load(t.captcha.loadFailed);
    }
  };

  const scale = challenge ? 100 / challenge.width : 0;
  const pieceLeft = challenge ? (pieceX - challenge.piece_size / 2) * scale : 0;
  const pieceWidth = challenge ? challenge.piece_size * scale : 0;
  const busy = phase === "loading" || phase === "verifying";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-background/95 p-5 text-center shadow-2xl">
        <h2 className="text-xl font-bold text-white">{t.captcha.title}</h2>
        <p className="mt-2 text-sm text-white/60">{t.captcha.subtitle}</p>

        <div
          ref={trackRef}
          className="relative mx-auto mt-5 w-full select-none overflow-hidden rounded-xl border border-white/15 bg-white/5"
          style={{ aspectRatio: challenge ? `${challenge.width} / ${challenge.height}` : "340 / 84", touchAction: "none" }}
        >
          {challenge && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={challenge.background} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
          )}
          {challenge && (
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragRef.current = null;
                if (challenge) setPieceX(challenge.start_x);
              }}
              className={`absolute top-1/2 -translate-y-1/2 ${phase === "ready" ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{ left: `${pieceLeft}%`, width: `${pieceWidth}%`, aspectRatio: "1 / 1", touchAction: "none" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={challenge.piece}
                alt=""
                draggable={false}
                className="h-full w-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
              />
            </div>
          )}
          {phase === "loading" && !challenge && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
              {t.common.loading}
            </div>
          )}
          {phase === "verifying" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
              {t.captcha.verifying}
            </div>
          )}
        </div>

        <p className="mt-3 min-h-5 text-xs text-red-400">{message}</p>

        <button
          type="button"
          disabled={busy}
          onClick={() => void load(null)}
          className="mx-auto mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-900/30 px-5 py-2 text-sm font-semibold text-amber-100 transition-opacity disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {t.captcha.refresh}
        </button>
      </div>
    </div>
  );
}

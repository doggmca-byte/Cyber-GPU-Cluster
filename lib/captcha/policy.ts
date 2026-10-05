/** Скільки діє пройдена верифікація (клієнт показує пазл знову, сервер вимагає свіжу для виводу). */
export const CAPTCHA_VALID_MS = 24 * 60 * 60 * 1000;

export function isCaptchaFresh(verifiedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!verifiedAt) return false;
  const ts = Date.parse(verifiedAt);
  return Number.isFinite(ts) && nowMs - ts < CAPTCHA_VALID_MS;
}

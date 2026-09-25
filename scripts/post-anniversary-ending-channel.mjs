/**
 * Один пост у канал спільноти (@CGPU_CL, TELEGRAM_COMMUNITY_URL) про те, що
 * юбілейна знижка 15% скоро закінчується. Той самий привід (місяць роботи
 * застосунку) і той самий залишок часу, що й у broadcast-anniversary-ending.mjs,
 * але це ОДИН пост у канал, а не розсилка кожному в особисті.
 *
 * Канал двомовний (RU/EN в одному повідомленні) — на відміну від розсилки в
 * особисті, де кожному своєю мовою.
 *
 * Запуск:
 *   node scripts/post-anniversary-ending-channel.mjs          # DRY RUN за замовчуванням: лише друкує текст
 *   node scripts/post-anniversary-ending-channel.mjs --send   # реальний пост у канал
 *
 * Захист: відмовляється постити, якщо юбілейна акція зараз НЕ активна.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMO_SLUG = "anniversary_1_month";
const CHANNEL = "@CGPU_CL";

function loadEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/\r$/, "");
  }
  return env;
}

const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_USERNAME = env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !BOT_USERNAME) {
  console.error("Missing TELEGRAM_BOT_TOKEN / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_TELEGRAM_BOT_USERNAME in .env.local");
  process.exit(1);
}

const SEND = process.argv.slice(2).includes("--send");
const LAUNCH_URL = `https://t.me/${BOT_USERNAME}?startapp=market`;

function splitCountdown(msLeft) {
  const totalSeconds = Math.max(Math.floor(msLeft / 1000), 0);
  const days = Math.floor(totalSeconds / 86400);
  const rest = totalSeconds % 86400;
  const hh = Math.floor(rest / 3600).toString().padStart(2, "0");
  const mm = Math.floor((rest % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(rest % 60).toString().padStart(2, "0");
  return { days, time: `${hh}:${mm}:${ss}` };
}

async function sb(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

function buildText({ days, time }) {
  return (
    `🔥 Осталось ${days} дн. ${time} — юбилейная скидка 15% в Cyber GPU Cluster скоро закончится!\n\n` +
    `Месяц назад мы запустились — и в честь этого держим -15% на ВСЁ оборудование в Маркете, от Raspberry Neural Core до Dyson Swarm ASI Nexus. Как только время выйдет, цены вернутся к обычным, без исключений.\n\n` +
    `Успейте забрать апгрейд по акционной цене! 🚀\n\n` +
    `━━━━━━━━━━\n\n` +
    `🔥 ${days}d ${time} left — Cyber GPU Cluster's 15% anniversary discount is ending soon!\n\n` +
    `We launched a month ago, and to celebrate we cut EVERY hardware module in the Market by 15% — from Raspberry Neural Core to Dyson Swarm ASI Nexus. Once the timer hits zero, prices go back to normal, no exceptions.\n\n` +
    `Grab your upgrade before it's gone! 🚀`
  );
}

async function main() {
  const promo = await sb("rpc/active_promo", { method: "POST", body: "{}" });
  const campaign = Array.isArray(promo) ? promo[0] : null;
  if (!campaign || campaign.slug !== PROMO_SLUG) {
    console.error(`Promo "${PROMO_SLUG}" is not active right now — refusing to announce a discount that is not live.`);
    process.exit(1);
  }

  const msLeft = new Date(campaign.ends_at).getTime() - Date.now();
  if (msLeft <= 0) {
    console.error(`Promo already ended at ${campaign.ends_at} — nothing to announce.`);
    process.exit(1);
  }

  const text = buildText(splitCountdown(msLeft));
  console.log(`Channel: ${CHANNEL}`);
  console.log(`Promo ends at: ${campaign.ends_at}`);
  console.log(`Text length: ${text.length} chars`);
  console.log(`Launch link: ${LAUNCH_URL}`);
  console.log("\n--- message ---\n" + text);

  if (!SEND) {
    console.log("\nDRY RUN — nothing was posted. Add --send to post for real.");
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      reply_markup: { inline_keyboard: [[{ text: "Открыть Маркет / Open Market", url: LAUNCH_URL }]] },
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) {
    console.error(`Failed to post: ${res.status} ${body.description ?? ""}`);
    process.exit(1);
  }
  console.log(`\nPosted. message_id=${body.result?.message_id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

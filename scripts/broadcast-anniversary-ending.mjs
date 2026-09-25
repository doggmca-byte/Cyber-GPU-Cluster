/**
 * Розсилка-нагадування: юбілейна акція "1 місяць Cyber GPU Cluster" (-15% на
 * все обладнання) скоро завершується — тиснемо на терміновість і причину
 * (місяць роботи застосунку), із залишком часу до ends_at, підрахованим У
 * МОМЕНТ ЗАПУСКУ (а не захардкодженим), щоб текст завжди був точним.
 *
 * Інфраструктура (аудиторія, пагінація, rate-limit, 403 -> is_bot_blocked,
 * лог відправленого) — та сама, що й у broadcast-anniversary.mjs.
 *
 * Запуск:
 *   node scripts/broadcast-anniversary-ending.mjs                  # DRY RUN за замовчуванням: нічого не шле, лише рахує
 *   node scripts/broadcast-anniversary-ending.mjs --send --limit=5 # реальна відправка перших 5 (пробний прогін)
 *   node scripts/broadcast-anniversary-ending.mjs --send           # повна розсилка
 *
 * Опції: --skip=N, --only=<telegram_id>
 *
 * Захист:
 *   - відмовляється працювати, якщо юбілейна акція зараз НЕ активна (active_promo());
 *   - лог відправленого (scripts/.anniversary-ending-sent.log): повторний запуск
 *     нікому не шле вдруге;
 *   - черга 25/с; 429 -> чекаємо retry_after; 403/"chat not found" -> is_bot_blocked = true.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENT_LOG = path.join(ROOT, "scripts", ".anniversary-ending-sent.log");
const PROMO_SLUG = "anniversary_1_month";

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

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const argValue = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=") || null;
const LIMIT = Number(argValue("limit")) || null;
const SKIP = Number(argValue("skip")) || 0;
const ONLY = argValue("only");
const RATE_PER_SECOND = 25;
const GAP_MS = Math.ceil(1000 / RATE_PER_SECOND);

const LAUNCH_URL = `https://t.me/${BOT_USERNAME}?startapp=market`;

// HH:MM:SS для решти доби — той самий формат, що й у самому Маркеті
// (lib/promo/promo.ts: splitCountdown), щоб цифри в розсилці збігалися з
// тим, що людина побачить, відкривши застосунок.
function splitCountdown(msLeft) {
  const totalSeconds = Math.max(Math.floor(msLeft / 1000), 0);
  const days = Math.floor(totalSeconds / 86400);
  const rest = totalSeconds % 86400;
  const hh = Math.floor(rest / 3600).toString().padStart(2, "0");
  const mm = Math.floor((rest % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(rest % 60).toString().padStart(2, "0");
  return { days, time: `${hh}:${mm}:${ss}` };
}

// Термінове нагадування: причина знижки (місяць роботи застосунку) + скільки
// точно лишилось + що буде, якщо не встигнути. Лише факти акції, без
// лічильників гравців.
const MESSAGES = {
  ru: ({ days, time }) => ({
    text: `🔥 Осталось ${days} дн. ${time} — юбилейная скидка 15% вот-вот закончится!\n\nМесяц назад запустился Cyber GPU Cluster, и в честь этого мы держим -15% на ВСЁ оборудование в Маркете — от Raspberry Neural Core до Dyson Swarm ASI Nexus. Как только время выйдет, цены вернутся к обычным, без исключений.\n\nНе тяните — апгрейд по этой цене больше не повторится.`,
    button: "Успеть по скидке",
  }),
  en: ({ days, time }) => ({
    text: `🔥 ${days}d ${time} left — the 15% anniversary discount is about to end!\n\nA month ago Cyber GPU Cluster launched, and to celebrate we cut EVERY hardware module in the Market by 15% — from Raspberry Neural Core to Dyson Swarm ASI Nexus. Once the timer hits zero, prices go back to normal — no exceptions.\n\nDon't wait — this price won't come back.`,
    button: "Grab the discount",
  }),
  uk: ({ days, time }) => ({
    text: `🔥 Залишилось ${days} дн. ${time} — ювілейна знижка 15% ось-ось закінчиться!\n\nМісяць тому запустився Cyber GPU Cluster, і на честь цього ми тримаємо -15% на УСЕ обладнання в Маркеті — від Raspberry Neural Core до Dyson Swarm ASI Nexus. Щойно час вийде, ціни повернуться до звичайних, без винятків.\n\nНе зволікайте — апгрейд за цією ціною більше не повториться.`,
    button: "Встигнути зі знижкою",
  }),
  es: ({ days, time }) => ({
    text: `🔥 Quedan ${days} d ${time} — ¡el descuento de aniversario del 15% está a punto de terminar!\n\nHace un mes lanzamos Cyber GPU Cluster, y para celebrarlo bajamos un 15% TODO el equipo del Mercado — desde Raspberry Neural Core hasta Dyson Swarm ASI Nexus. En cuanto acabe el tiempo, los precios vuelven a la normalidad, sin excepciones.\n\nNo esperes — este precio no volverá.`,
    button: "Aprovechar el descuento",
  }),
  ar: ({ days, time }) => ({
    text: `🔥 تبقّى ${days} يوم ${time} — خصم الذكرى السنوية 15% على وشك الانتهاء!\n\nقبل شهر انطلق Cyber GPU Cluster، واحتفالًا بذلك خفّضنا 15% على كل معدات المتجر — من Raspberry Neural Core حتى Dyson Swarm ASI Nexus. بمجرد انتهاء الوقت، تعود الأسعار كما كانت، بلا استثناء.\n\nلا تنتظر — هذا السعر لن يتكرر.`,
    button: "احصل على الخصم",
  }),
  id: ({ days, time }) => ({
    text: `🔥 Tersisa ${days} hr ${time} — diskon ulang tahun 15% segera berakhir!\n\nSebulan lalu Cyber GPU Cluster diluncurkan, dan untuk merayakannya kami memberi diskon 15% untuk SEMUA perangkat di Market — dari Raspberry Neural Core hingga Dyson Swarm ASI Nexus. Begitu waktu habis, harga kembali normal, tanpa kecuali.\n\nJangan tunda — harga ini tidak akan kembali.`,
    button: "Ambil diskonnya",
  }),
  tr: ({ days, time }) => ({
    text: `🔥 ${days} gün ${time} kaldı — %15 yıl dönümü indirimi bitmek üzere!\n\nBir ay önce Cyber GPU Cluster yayına girdi, bunu kutlamak için Market'teki TÜM donanımda %15 indirim uyguluyoruz — Raspberry Neural Core'dan Dyson Swarm ASI Nexus'a kadar. Süre dolduğunda fiyatlar istisnasız normale dönecek.\n\nBekleme — bu fiyat bir daha gelmeyecek.`,
    button: "İndirimi kaçırma",
  }),
  kk: ({ days, time }) => ({
    text: `🔥 ${days} күн ${time} қалды — 15% мерейтой жеңілдігі жақында аяқталады!\n\nБір ай бұрын Cyber GPU Cluster іске қосылды, осыған орай Маркеттегі БАРЛЫҚ жабдыққа 15% жеңілдік беріп тұрмыз — Raspberry Neural Core-дан Dyson Swarm ASI Nexus-қа дейін. Уақыт аяқталысымен бағалар қалыпты күйіне қайтады, ешбір ерекшеліксіз.\n\nКешіктірмеңіз — бұл баға қайталанбайды.`,
    button: "Жеңілдікті пайдалану",
  }),
};

const SUPPORTED = Object.keys(MESSAGES);
const resolveLang = (code) => {
  const base = (code ?? "").slice(0, 2).toLowerCase();
  return SUPPORTED.includes(base) ? base : "en";
};

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

async function sbAll(pathname, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = await sb(pathname, {
      headers: { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" },
    });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function markBotBlocked(telegramId) {
  try {
    await sb(`profiles?telegram_id=eq.${telegramId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_bot_blocked: true }),
    });
  } catch (err) {
    console.error(`  ! failed to flag ${telegramId}: ${err.message}`);
  }
}

const api = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

async function sendOne(telegramId, message) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramId,
      text: message.text,
      reply_markup: { inline_keyboard: [[{ text: message.button, url: LAUNCH_URL }]] },
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.ok === true, status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadSent() {
  try {
    return new Set(fs.readFileSync(SENT_LOG, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
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
  const remaining = splitCountdown(msLeft);

  const rows = await sbAll(
    "profiles?select=telegram_id,telegram_language_code&is_bot_blocked=eq.false&order=created_at.asc",
  );
  const alreadySent = loadSent();
  const pending = rows.filter((r) => !alreadySent.has(String(r.telegram_id)));
  const queue = SKIP > 0 ? pending.slice(SKIP) : pending;
  const audience = ONLY
    ? await sb(`profiles?select=telegram_id,telegram_language_code&telegram_id=eq.${encodeURIComponent(ONLY)}`)
    : LIMIT
      ? queue.slice(0, LIMIT)
      : queue;

  console.log(`Promo: ${campaign.slug} -${campaign.discount_percent}% until ${campaign.ends_at}`);
  console.log(`Time left: ${remaining.days} d ${remaining.time}`);
  console.log(`Reachable profiles (is_bot_blocked = false): ${rows.length}; already sent earlier: ${rows.length - pending.length}`);
  console.log(`Audience this run: ${audience.length}${SKIP ? ` (skip ${SKIP})` : ""}${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  console.log(`Launch link: ${LAUNCH_URL}`);
  console.log(`Rate: ${RATE_PER_SECOND}/s (gap ${GAP_MS}ms)`);

  const byLang = {};
  for (const r of audience) {
    const l = resolveLang(r.telegram_language_code);
    byLang[l] = (byLang[l] ?? 0) + 1;
  }
  console.log("By language:", byLang);

  if (!SEND) {
    console.log("\nDRY RUN — nothing was sent. Add --send to send for real.");
    console.log("\n--- sample (ru) ---\n" + MESSAGES.ru(remaining).text);
    return;
  }

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of audience) {
    const message = MESSAGES[resolveLang(row.telegram_language_code)](remaining);
    let attempt = 0;

    while (attempt < 3) {
      const result = await sendOne(row.telegram_id, message);

      if (result.ok) {
        sent++;
        if (!ONLY) fs.appendFileSync(SENT_LOG, `${row.telegram_id}\n`);
        break;
      }

      if (result.status === 429) {
        const wait = ((result.body.parameters?.retry_after ?? 1) + 1) * 1000;
        console.log(`  429 — waiting ${wait}ms`);
        await sleep(wait);
        attempt++;
        continue;
      }

      const description = result.body.description ?? "";
      if (result.status === 403 || /chat not found|bot was blocked|user is deactivated/i.test(description)) {
        await markBotBlocked(row.telegram_id);
        blocked++;
        break;
      }

      failed++;
      console.error(`  ! ${row.telegram_id}: ${result.status} ${description}`);
      break;
    }

    await sleep(GAP_MS);
    if ((sent + blocked + failed) % 200 === 0) {
      console.log(`  progress: sent=${sent} blocked=${blocked} failed=${failed}`);
    }
  }

  console.log(`\nDone. sent=${sent} blocked(flagged)=${blocked} failed=${failed} of ${audience.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

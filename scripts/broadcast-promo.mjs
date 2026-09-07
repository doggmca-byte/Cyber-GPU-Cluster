/**
 * Розсилка анонсу акції -10% (48 годин) усім гравцям їхньою мовою.
 *
 * Запуск:
 *   node scripts/broadcast-promo.mjs --dry-run          # нічого не шле, лише рахує аудиторію
 *   node scripts/broadcast-promo.mjs --limit=20         # реальна відправка перших 20 (пробний прогін)
 *   node scripts/broadcast-promo.mjs                    # повна розсилка
 *   node scripts/broadcast-promo.mjs --milestone=3000   # число в заголовку (див. нижче)
 *
 * Читає .env.local: TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.
 *
 * Захист від блокувань:
 *   - черга з обмеженням швидкості (RATE_PER_SECOND, за замовчуванням 25/с —
 *     у межах ліміту Telegram Bot API ~30/с на бота);
 *   - 429 → чекаємо retry_after і повторюємо це саме повідомлення;
 *   - 403 (користувач зупинив бота) і "chat not found" → ставимо
 *     profiles.is_bot_blocked = true, щоб наступні розсилки таких не чіпали.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_USERNAME = env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || null;
const MILESTONE = Number((args.find((a) => a.startsWith("--milestone=")) ?? "").split("=")[1]) || null;
const RATE_PER_SECOND = 25;
const GAP_MS = Math.ceil(1000 / RATE_PER_SECOND);

// Моделі, на які діє знижка — читаються з БД, щоб текст не розійшовся з акцією.
const LAUNCH_URL = `https://t.me/${BOT_USERNAME}?startapp=market`;

const MESSAGES = {
  en: (n, rigs) => ({
    text: `⚡ ${n} miners are now on Cyber GPU Cluster.\n\nTo mark it, we've switched on a 10% discount on:\n${rigs}\n\nThe promo runs for exactly 48 hours.`,
    button: "Open Market",
  }),
  ru: (n, rigs) => ({
    text: `⚡ В Cyber GPU Cluster уже ${n} майнеров.\n\nПо этому поводу включили скидку 10% на:\n${rigs}\n\nАкция действует ровно 48 часов.`,
    button: "Открыть маркет",
  }),
  uk: (n, rigs) => ({
    text: `⚡ У Cyber GPU Cluster уже ${n} майнерів.\n\nЗ цієї нагоди увімкнули знижку 10% на:\n${rigs}\n\nАкція діє рівно 48 годин.`,
    button: "Відкрити маркет",
  }),
  es: (n, rigs) => ({
    text: `⚡ Ya somos ${n} mineros en Cyber GPU Cluster.\n\nPara celebrarlo, activamos un 10% de descuento en:\n${rigs}\n\nLa promoción dura exactamente 48 horas.`,
    button: "Abrir mercado",
  }),
  ar: (n, rigs) => ({
    text: `⚡ وصلنا إلى ${n} منقّب في Cyber GPU Cluster.\n\nبهذه المناسبة فعّلنا خصم 10% على:\n${rigs}\n\nالعرض ساري لمدة 48 ساعة بالضبط.`,
    button: "افتح المتجر",
  }),
  id: (n, rigs) => ({
    text: `⚡ Sudah ada ${n} penambang di Cyber GPU Cluster.\n\nUntuk merayakannya, kami aktifkan diskon 10% untuk:\n${rigs}\n\nPromo berlaku tepat 48 jam.`,
    button: "Buka Market",
  }),
  kk: (n, rigs) => ({
    text: `⚡ Cyber GPU Cluster-де ${n} майнер бар.\n\nОсы орайда 10% жеңілдік қостық:\n${rigs}\n\nАкция дәл 48 сағат жұмыс істейді.`,
    button: "Дүкенді ашу",
  }),
  tr: (n, rigs) => ({
    text: `⚡ Cyber GPU Cluster'da ${n} madenci var.\n\nBu vesileyle şu modellerde %10 indirim açtık:\n${rigs}\n\nKampanya tam 48 saat sürüyor.`,
    button: "Marketi aç",
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

/**
 * PostgREST за замовчуванням віддає максимум 1000 рядків — без посторінкового
 * читання розсилка мовчки охопила б лише перших 1000 із 3000+ гравців
 * (реально спіймано на dry-run). Тягнемо сторінками через Range, доки
 * сторінка не стане коротшою за розмір вікна.
 */
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

async function sendOne(telegramId, message) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
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

async function main() {
  // Аудиторія: усі, крім уже позначених як такі, що зупинили бота.
  const rows = await sbAll(
    "profiles?select=telegram_id,telegram_language_code&is_bot_blocked=eq.false&order=created_at.asc",
  );
  const audience = LIMIT ? rows.slice(0, LIMIT) : rows;

  // Назви акційних моделей — з тієї самої БД, що й сама акція.
  const promo = await sb("rpc/active_promo", { method: "POST", body: "{}" });
  const campaign = Array.isArray(promo) ? promo[0] : null;
  if (!campaign) {
    console.error("No active promo campaign — refusing to announce a discount that is not live.");
    process.exit(1);
  }
  const templates = await sb("gpu_templates?select=level,name&order=level.asc");
  const rigs = templates
    .filter((tpl) => campaign.target_levels.includes(tpl.level))
    .map((tpl) => `• ${tpl.name}`)
    .join("\n");

  const milestone = MILESTONE ?? rows.length;

  console.log(`Audience: ${audience.length}${LIMIT ? ` (limited from ${rows.length})` : ""}`);
  console.log(`Milestone in the text: ${milestone}`);
  console.log(`Discounted rigs:\n${rigs}`);
  console.log(`Promo ends at: ${campaign.ends_at}`);
  console.log(`Rate: ${RATE_PER_SECOND}/s (gap ${GAP_MS}ms)${DRY_RUN ? " — DRY RUN" : ""}`);

  const byLang = {};
  for (const r of audience) byLang[resolveLang(r.telegram_language_code)] = (byLang[resolveLang(r.telegram_language_code)] ?? 0) + 1;
  console.log("By language:", byLang);

  if (DRY_RUN) {
    console.log("\n--- sample (ru) ---\n" + MESSAGES.ru(milestone, rigs).text);
    return;
  }

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of audience) {
    const message = MESSAGES[resolveLang(row.telegram_language_code)](milestone, rigs);
    let attempt = 0;

    while (attempt < 3) {
      const result = await sendOne(row.telegram_id, message);

      if (result.ok) { sent++; break; }

      // Ліміт Telegram — чекаємо рівно стільки, скільки просить API.
      if (result.status === 429) {
        const wait = ((result.body.parameters?.retry_after ?? 1) + 1) * 1000;
        console.log(`  429 — waiting ${wait}ms`);
        await sleep(wait);
        attempt++;
        continue;
      }

      // Користувач зупинив бота / чат недоступний — більше не турбуємо.
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

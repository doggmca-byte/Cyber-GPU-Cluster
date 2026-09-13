/**
 * Розсилка про канал транзакцій @CGPU_transactions.
 * Інфраструктура (черга, ліміт швидкості, 429, 403 -> is_bot_blocked,
 * пагінація) спільна з broadcast-promo.mjs — тут інші тексти й інша аудиторія.
 *
 * Аудиторія: АКТИВНІ гравці — ті, хто відкривав застосунок за останні
 * ACTIVE_DAYS днів (profiles.last_seen_at, який пишеться з моменту появи
 * логу сесій) і кому бот узагалі може писати. Це навмисно вужче за "всіх
 * незаблокованих": решта — переважно ті, хто запустив Mini App за посиланням
 * і жодного разу не тиснув Start, тож повідомлення їм або не дійде, або
 * прилетить людині, яка вже давно не в грі.
 *
 * Запуск:
 *   node scripts/broadcast-transactions-channel.mjs --dry-run     # лише рахує аудиторію
 *   node scripts/broadcast-transactions-channel.mjs --limit=10    # пробний прогін
 *   node scripts/broadcast-transactions-channel.mjs --skip=10     # решта після пробного
 *   node scripts/broadcast-transactions-channel.mjs --days=30     # ширше вікно активності
 *
 * Читає .env.local: TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY.
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

if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || null;
const SKIP = Number((args.find((a) => a.startsWith("--skip=")) ?? "").split("=")[1]) || 0;
const ACTIVE_DAYS = Number((args.find((a) => a.startsWith("--days=")) ?? "").split("=")[1]) || 7;
const RATE_PER_SECOND = 25;
const GAP_MS = Math.ceil(1000 / RATE_PER_SECOND);

const CHANNEL_URL = "https://t.me/CGPU_transactions";

const MESSAGES = {
  en: {
    text: `📢 Every payout is now public.

Each deposit and each withdrawal goes to our new channel automatically — the amount and a link to the transaction on the blockchain.

Subscribe and claim +0.02 TON for the task in the app.`,
    button: "Open channel",
  },
  ru: {
    text: `📢 Все выплаты теперь публичны.

Каждое пополнение и каждая выплата попадают в наш новый канал автоматически — сумма и ссылка на транзакцию в блокчейне.

Подпишись и забери +0.02 TON за задание в приложении.`,
    button: "Открыть канал",
  },
  uk: {
    text: `📢 Усі виплати тепер публічні.

Кожне поповнення та кожна виплата потрапляють у наш новий канал автоматично — сума й посилання на транзакцію в блокчейні.

Підпишись і забери +0.02 TON за завдання в застосунку.`,
    button: "Відкрити канал",
  },
  es: {
    text: `📢 Todos los pagos ahora son públicos.

Cada depósito y cada retiro llegan a nuestro nuevo canal automáticamente: el importe y un enlace a la transacción en la blockchain.

Suscríbete y reclama +0.02 TON por la tarea en la app.`,
    button: "Abrir canal",
  },
  ar: {
    text: `📢 جميع المدفوعات أصبحت علنية.

كل إيداع وكل سحب يُنشر تلقائيًا في قناتنا الجديدة — المبلغ ورابط المعاملة على البلوكتشين.

اشترك واحصل على +0.02 TON مقابل المهمة في التطبيق.`,
    button: "افتح القناة",
  },
  id: {
    text: `📢 Semua pembayaran kini terbuka.

Setiap deposit dan setiap penarikan masuk ke kanal baru kami secara otomatis — jumlahnya dan tautan ke transaksi di blockchain.

Gabung dan ambil +0.02 TON dari tugas di aplikasi.`,
    button: "Buka kanal",
  },
  kk: {
    text: `📢 Барлық төлемдер енді ашық.

Әрбір толықтыру мен әрбір төлем жаңа арнамызға автоматты түрде түседі — сомасы және блокчейндегі транзакцияға сілтеме.

Жазыл да, қосымшадағы тапсырма үшін +0.02 TON ал.`,
    button: "Арнаны ашу",
  },
  tr: {
    text: `📢 Tüm ödemeler artık herkese açık.

Her yatırma ve her çekim yeni kanalımıza otomatik olarak düşüyor — tutar ve blok zincirindeki işlemin bağlantısı.

Abone ol ve uygulamadaki görevden +0.02 TON al.`,
    button: "Kanalı aç",
  },
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
 * читання розсилка мовчки охопила б лише перших 1000 адресатів.
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
      reply_markup: { inline_keyboard: [[{ text: message.button, url: CHANNEL_URL }]] },
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.ok === true, status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const since = new Date(Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await sbAll(
    `profiles?select=telegram_id,telegram_language_code,last_seen_at&is_bot_blocked=eq.false&last_seen_at=gte.${since}&order=last_seen_at.desc`,
  );

  const queue = SKIP > 0 ? rows.slice(SKIP) : rows;
  const audience = LIMIT ? queue.slice(0, LIMIT) : queue;

  console.log(`Active window: ${ACTIVE_DAYS} days (since ${since})`);
  console.log(`Audience: ${audience.length} of ${rows.length}${SKIP ? ` (skipping first ${SKIP})` : ""}${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  console.log(`Rate: ${RATE_PER_SECOND}/s (gap ${GAP_MS}ms)${DRY_RUN ? " — DRY RUN" : ""}`);

  const byLang = {};
  for (const r of audience) {
    const lang = resolveLang(r.telegram_language_code);
    byLang[lang] = (byLang[lang] ?? 0) + 1;
  }
  console.log("By language:", byLang);

  if (DRY_RUN) {
    console.log("\n--- sample (ru) ---\n" + MESSAGES.ru.text + `\n[ ${MESSAGES.ru.button} -> ${CHANNEL_URL} ]`);
    return;
  }

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of audience) {
    const message = MESSAGES[resolveLang(row.telegram_language_code)];
    let attempt = 0;

    while (attempt < 3) {
      const result = await sendOne(row.telegram_id, message);

      if (result.ok) {
        sent++;
        break;
      }

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

    if ((sent + blocked + failed) % 100 === 0) {
      console.log(`  progress: sent ${sent}, blocked ${blocked}, failed ${failed}`);
    }
    await sleep(GAP_MS);
  }

  console.log(`\nDone. sent=${sent} blocked=${blocked} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

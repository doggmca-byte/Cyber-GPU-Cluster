/**
 * Розсилка анонсу юбілейної акції "1 місяць Cyber GPU Cluster" (-15% на все
 * обладнання, 7 діб) усім досяжним гравцям — їхньою мовою, з банером.
 *
 * Запуск:
 *   node scripts/broadcast-anniversary.mjs                  # DRY RUN за замовчуванням: нічого не шле, лише рахує
 *   node scripts/broadcast-anniversary.mjs --send --limit=5 # реальна відправка перших 5 (пробний прогін)
 *   node scripts/broadcast-anniversary.mjs --send           # повна розсилка
 *
 * Опції: --photo=<шлях до PNG/JPG>  (за замовчуванням scripts/assets/anniversary-banner.png, якщо є)
 *        --skip=N                   пропустити перших N адресатів
 *        --only=<telegram_id>       тестова відправка ОДНІЙ людині (напр. собі); лог відправленого не пишеться
 *
 * Реальна відправка вмикається ЛИШЕ прапорцем --send (у старих скриптах
 * розсилки повна відправка була "за замовчуванням" — тут навмисно навпаки).
 *
 * Захист:
 *   - відмовляється працювати, якщо юбілейна акція зараз НЕ активна (active_promo());
 *   - лог відправленого (scripts/.anniversary-sent.log): повторний запуск нікому
 *     не шле вдруге, тож розсилку можна безпечно продовжити після збою;
 *   - черга 25/с (ліміт Telegram ~30/с); 429 -> чекаємо retry_after;
 *   - 403 / "chat not found" -> profiles.is_bot_blocked = true;
 *   - у тексті НІЯКИХ лічильників гравців: лише факти акції.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENT_LOG = path.join(ROOT, "scripts", ".anniversary-sent.log");
const DEFAULT_PHOTO = path.join(ROOT, "scripts", "assets", "anniversary-banner.png");
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
const PHOTO_PATH = argValue("photo") ?? (fs.existsSync(DEFAULT_PHOTO) ? DEFAULT_PHOTO : null);
const RATE_PER_SECOND = 25;
const GAP_MS = Math.ceil(1000 / RATE_PER_SECOND);

const LAUNCH_URL = `https://t.me/${BOT_USERNAME}?startapp=market`;

// Підпис до фото (ліміт Telegram — 1024 символи). Лише факти акції.
const MESSAGES = {
  ru: {
    text: "🎉 Cyber GPU Cluster — нам 1 месяц!\n\nВ честь первого юбилея — скидка 15% на ВСЕ модули оборудования в Маркете: от Raspberry Neural Core до Dyson Swarm ASI Nexus.\n\n⏱ Акция действует 7 дней — до 28 сентября, 00:00 UTC. Таймер уже идёт в Маркете.\n\nСпасибо, что вы с нами! 🚀",
    button: "Открыть Маркет",
  },
  en: {
    text: "🎉 Cyber GPU Cluster turns 1 month old!\n\nTo celebrate, every hardware module in the Market is 15% off — from Raspberry Neural Core to Dyson Swarm ASI Nexus.\n\n⏱ Runs for 7 days — until Sept 28, 00:00 UTC. The countdown is live in the Market.\n\nThank you for being with us! 🚀",
    button: "Open Market",
  },
  uk: {
    text: "🎉 Cyber GPU Cluster — нам 1 місяць!\n\nНа честь першого ювілею — знижка 15% на УСІ модулі обладнання в Маркеті: від Raspberry Neural Core до Dyson Swarm ASI Nexus.\n\n⏱ Акція діє 7 днів — до 28 вересня, 00:00 UTC. Відлік уже йде в Маркеті.\n\nДякуємо, що ви з нами! 🚀",
    button: "Відкрити Маркет",
  },
  es: {
    text: "🎉 ¡Cyber GPU Cluster cumple 1 mes!\n\nPara celebrarlo, todo el equipo del Mercado tiene un 15% de descuento: desde Raspberry Neural Core hasta Dyson Swarm ASI Nexus.\n\n⏱ Dura 7 días — hasta el 28 de septiembre, 00:00 UTC. La cuenta atrás ya corre en el Mercado.\n\n¡Gracias por estar con nosotros! 🚀",
    button: "Abrir Mercado",
  },
  ar: {
    text: "🎉 Cyber GPU Cluster يحتفل بشهره الأول!\n\nاحتفالًا بهذه المناسبة، خصم 15% على جميع معدات المتجر: من Raspberry Neural Core حتى Dyson Swarm ASI Nexus.\n\n⏱ العرض ساري لمدة 7 أيام — حتى 28 سبتمبر الساعة 00:00 بتوقيت UTC. العدّ التنازلي ظاهر الآن في المتجر.\n\nشكرًا لوجودكم معنا! 🚀",
    button: "افتح المتجر",
  },
  id: {
    text: "🎉 Cyber GPU Cluster berusia 1 bulan!\n\nUntuk merayakannya, semua perangkat di Market diskon 15% — dari Raspberry Neural Core hingga Dyson Swarm ASI Nexus.\n\n⏱ Berlaku 7 hari — hingga 28 September, 00:00 UTC. Hitung mundur sudah berjalan di Market.\n\nTerima kasih sudah bersama kami! 🚀",
    button: "Buka Market",
  },
  tr: {
    text: "🎉 Cyber GPU Cluster 1 aylık oldu!\n\nBu vesileyle Market'teki tüm ekipmanlarda %15 indirim: Raspberry Neural Core'dan Dyson Swarm ASI Nexus'a kadar.\n\n⏱ Kampanya 7 gün sürüyor — 28 Eylül, 00:00 UTC'ye kadar. Geri sayım Market'te şimdiden işliyor.\n\nBizimle olduğunuz için teşekkürler! 🚀",
    button: "Marketi aç",
  },
  kk: {
    text: "🎉 Cyber GPU Cluster — 1 ай толды!\n\nОсы мерекеге орай Маркеттегі БАРЛЫҚ жабдыққа 15% жеңілдік: Raspberry Neural Core-дан Dyson Swarm ASI Nexus-қа дейін.\n\n⏱ Акция 7 күн жұмыс істейді — 28 қыркүйек, 00:00 UTC-ке дейін. Кері санақ Маркетте қазірдің өзінде жүріп жатыр.\n\nБізбен болғандарыңызға рақмет! 🚀",
    button: "Маркетті ашу",
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

// PostgREST віддає максимум 1000 рядків за запит — читаємо сторінками.
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

/**
 * Фото вантажимо лише для першого адресата; далі всім шлемо той самий
 * file_id, який повернув Telegram, — без повторного завантаження 2.7 МБ.
 */
async function sendOne(telegramId, message, photo) {
  const replyMarkup = { inline_keyboard: [[{ text: message.button, url: LAUNCH_URL }]] };
  let res;

  if (photo && photo.fileId) {
    res = await fetch(api("sendPhoto"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, photo: photo.fileId, caption: message.text, reply_markup: replyMarkup }),
    });
  } else if (photo) {
    const form = new FormData();
    form.append("chat_id", String(telegramId));
    form.append("caption", message.text);
    form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append("photo", new Blob([photo.bytes], { type: photo.mime }), path.basename(photo.path));
    res = await fetch(api("sendPhoto"), { method: "POST", body: form });
  } else {
    res = await fetch(api("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text: message.text, reply_markup: replyMarkup, disable_web_page_preview: true }),
    });
  }

  const body = await res.json().catch(() => ({}));
  const ok = res.ok && body.ok === true;
  if (ok && photo && !photo.fileId) photo.fileId = body.result?.photo?.at(-1)?.file_id ?? null;
  return { ok, status: res.status, body };
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
  // Акцію анонсуємо, лише поки вона реально діє (за часом БД).
  const promo = await sb("rpc/active_promo", { method: "POST", body: "{}" });
  const campaign = Array.isArray(promo) ? promo[0] : null;
  if (!campaign || campaign.slug !== PROMO_SLUG) {
    console.error(`Promo "${PROMO_SLUG}" is not active right now — refusing to announce a discount that is not live.`);
    process.exit(1);
  }

  const rows = await sbAll(
    "profiles?select=telegram_id,telegram_language_code&is_bot_blocked=eq.false&order=created_at.asc",
  );
  const alreadySent = loadSent();
  const pending = rows.filter((r) => !alreadySent.has(String(r.telegram_id)));
  const queue = SKIP > 0 ? pending.slice(SKIP) : pending;
  // --only: тест на одну людину (навіть якщо вона вже в логу або позначена як недосяжна).
  const audience = ONLY
    ? await sb(`profiles?select=telegram_id,telegram_language_code&telegram_id=eq.${encodeURIComponent(ONLY)}`)
    : LIMIT
      ? queue.slice(0, LIMIT)
      : queue;

  let photo = null;
  if (PHOTO_PATH) {
    const bytes = fs.readFileSync(PHOTO_PATH);
    const mime = PHOTO_PATH.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    photo = { path: PHOTO_PATH, bytes, mime, fileId: null };
  }

  for (const [lang, m] of Object.entries(MESSAGES)) {
    if (m.text.length > 1024) throw new Error(`Caption for "${lang}" is ${m.text.length} chars (limit 1024)`);
  }

  console.log(`Promo: ${campaign.slug} -${campaign.discount_percent}% until ${campaign.ends_at}`);
  console.log(`Reachable profiles (is_bot_blocked = false): ${rows.length}; already sent earlier: ${rows.length - pending.length}`);
  console.log(`Audience this run: ${audience.length}${SKIP ? ` (skip ${SKIP})` : ""}${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  console.log(`Photo: ${photo ? `${photo.path} (${(photo.bytes.length / 1024 / 1024).toFixed(2)} MB)` : "none — text only"}`);
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
    console.log("\n--- sample (ru) ---\n" + MESSAGES.ru.text);
    return;
  }

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of audience) {
    const message = MESSAGES[resolveLang(row.telegram_language_code)];
    let attempt = 0;

    while (attempt < 3) {
      const result = await sendOne(row.telegram_id, message, photo);

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

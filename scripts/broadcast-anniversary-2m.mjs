/**
 * Розсилка анонсу ювілейної акції "2 місяці Cyber GPU Cluster" (-15% на всі
 * майнери, 1 доба) усім досяжним гравцям — їхньою мовою, з банером і кнопками
 * на всі ресурси проєкту (Маркет, канал, чат, канал виплат, підтримка).
 *
 * Запуск:
 *   node scripts/broadcast-anniversary-2m.mjs                     # DRY RUN за замовчуванням: нічого не шле, лише рахує
 *   node scripts/broadcast-anniversary-2m.mjs --send --only=<id>  # тест одній людині (напр. собі)
 *   node scripts/broadcast-anniversary-2m.mjs --send --limit=5    # реальна відправка перших 5 (пробний прогін)
 *   node scripts/broadcast-anniversary-2m.mjs --send              # повна розсилка
 *
 * Опції: --photo=<шлях до PNG/JPG>  (за замовчуванням scripts/assets/anniversary-2m-banner.png, якщо є)
 *        --skip=N                   пропустити перших N адресатів
 *        --only=<telegram_id>       тестова відправка ОДНІЙ людині; лог відправленого не пишеться
 *        --lang=<code>              з --only: примусово мова тексту (перевірити переклад)
 *
 * Захист:
 *   - відмовляється працювати, якщо акція anniversary_2_months зараз НЕ активна (active_promo());
 *   - лог відправленого (scripts/.anniversary-2m-sent.log): повторний запуск нікому
 *     не шле вдруге, тож розсилку можна безпечно продовжити після збою;
 *   - черга 25/с (ліміт Telegram ~30/с); 429 -> чекаємо retry_after;
 *   - 403 / "chat not found" -> profiles.is_bot_blocked = true;
 *   - у тексті НІЯКИХ лічильників гравців і обіцянок доходу: лише перевірювані факти.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENT_LOG = path.join(ROOT, "scripts", ".anniversary-2m-sent.log");
const DEFAULT_PHOTO = path.join(ROOT, "scripts", "assets", "anniversary-2m-banner.png");
const PROMO_SLUG = "anniversary_2_months";

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
const FORCE_LANG = argValue("lang");
const PHOTO_PATH = argValue("photo") ?? (fs.existsSync(DEFAULT_PHOTO) ? DEFAULT_PHOTO : null);
const RATE_PER_SECOND = 25;
const GAP_MS = Math.ceil(1000 / RATE_PER_SECOND);

const LINKS = {
  market: `https://t.me/${BOT_USERNAME}?startapp=market`,
  channel: env.TELEGRAM_COMMUNITY_URL || "https://t.me/CGPU_CL",
  chat: env.TELEGRAM_CHAT_URL || "https://t.me/GPU_ChitChat",
  payouts: "https://t.me/CGPU_transactions",
  support: env.NEXT_PUBLIC_SUPPORT_URL || "https://t.me/GPU_Support",
};

// Підпис до фото (parse_mode HTML; ліміт Telegram — 1024 символи БЕЗ тегів).
const MESSAGES = {
  ru: {
    text: `💜 <b>Нам 2 месяца. Спасибо, что вы с нами</b>

Два месяца назад Cyber GPU Cluster был просто идеей. Сегодня это живое сообщество, ферма каждый день, выводы, ваши вопросы в чате и предложения, которые мы внедряем.

Мы знаем, что в Telegram много проектов, которые исчезают через неделю. Поэтому мы не просим нам верить на слово:
✅ каждый вывод публикуется в открытом канале @CGPU_transactions с хешем транзакции — его можно проверить в блокчейне TON
✅ на связи живая поддержка @GPU_Support и чат @GPU_ChitChat

В честь нашего маленького праздника дарим <b>скидку 15% на все майнеры</b> в Маркете — от Raspberry Neural Core до Dyson Swarm ASI Nexus.

⏱ Акция действует 1 день — до 21 октября, 03:00 МСК.
Скидка применяется автоматически, прямо в приложении. Никаких промокодов и переводов «админам» в личку.

Спасибо, что растёте вместе с нами. Впереди ещё много всего 🚀

Команда Cyber GPU Cluster`,
    buttons: { market: "🛒 Открыть Маркет −15%", channel: "📢 Канал", chat: "💬 Чат", payouts: "💸 Выплаты", support: "🛟 Поддержка" },
  },
  en: {
    text: `💜 <b>We're 2 months old. Thank you for being with us</b>

Two months ago Cyber GPU Cluster was just an idea. Today it's a living community: farms running every day, withdrawals, your questions in the chat and suggestions we keep building in.

We know Telegram is full of projects that vanish after a week. That's why we don't ask you to take our word for it:
✅ every withdrawal is published in the public channel @CGPU_transactions with its transaction hash — you can check it on the TON blockchain
✅ real people answer in support @GPU_Support and in our chat @GPU_ChitChat

To celebrate our little milestone, we're giving you <b>15% off all miners</b> in the Market — from Raspberry Neural Core to Dyson Swarm ASI Nexus.

⏱ The offer runs for 1 day — until October 21, 00:00 UTC.
The discount applies automatically, right in the app. No promo codes, and no transfers to "admins" in DMs.

Thank you for growing with us. There's a lot more ahead 🚀

The Cyber GPU Cluster team`,
    buttons: { market: "🛒 Open Market −15%", channel: "📢 Channel", chat: "💬 Chat", payouts: "💸 Payouts", support: "🛟 Support" },
  },
  uk: {
    text: `💜 <b>Нам 2 місяці. Дякуємо, що ви з нами</b>

Два місяці тому Cyber GPU Cluster був лише ідеєю. Сьогодні це жива спільнота: ферми працюють щодня, йдуть виводи, у чаті — ваші запитання та пропозиції, які ми впроваджуємо.

Ми знаємо, що в Telegram багато проєктів, які зникають за тиждень. Тому ми не просимо вірити нам на слово:
✅ кожен вивід публікується у відкритому каналі @CGPU_transactions з хешем транзакції — його можна перевірити в блокчейні TON
✅ на зв'язку жива підтримка @GPU_Support і чат @GPU_ChitChat

На честь нашого маленького свята даруємо <b>знижку 15% на всі майнери</b> в Маркеті — від Raspberry Neural Core до Dyson Swarm ASI Nexus.

⏱ Акція діє 1 день — до 21 жовтня, 03:00 за Києвом.
Знижка застосовується автоматично, прямо в застосунку. Жодних промокодів і переказів «адмінам» в особисті.

Дякуємо, що ростете разом із нами. Попереду ще багато всього 🚀

Команда Cyber GPU Cluster`,
    buttons: { market: "🛒 Відкрити Маркет −15%", channel: "📢 Канал", chat: "💬 Чат", payouts: "💸 Виплати", support: "🛟 Підтримка" },
  },
  es: {
    text: `💜 <b>Cumplimos 2 meses. Gracias por estar con nosotros</b>

Hace dos meses, Cyber GPU Cluster era solo una idea. Hoy es una comunidad viva: granjas activas cada día, retiros, tus preguntas en el chat e ideas que incorporamos.

Sabemos que en Telegram hay muchos proyectos que desaparecen en una semana. Por eso no te pedimos que nos creas sin más:
✅ cada retiro se publica en el canal público @CGPU_transactions con el hash de la transacción — puedes comprobarlo en la blockchain de TON
✅ personas reales responden en @GPU_Support y en el chat @GPU_ChitChat

Para celebrar nuestro pequeño aniversario, te regalamos <b>un 15% de descuento en todos los mineros</b> del Mercado — desde Raspberry Neural Core hasta Dyson Swarm ASI Nexus.

⏱ La oferta dura 1 día — hasta el 21 de octubre, 00:00 UTC.
El descuento se aplica automáticamente, dentro de la app. Sin códigos promo ni transferencias a «admins» por privado.

Gracias por crecer con nosotros. Queda mucho por venir 🚀

El equipo de Cyber GPU Cluster`,
    buttons: { market: "🛒 Abrir Mercado −15%", channel: "📢 Canal", chat: "💬 Chat", payouts: "💸 Retiros", support: "🛟 Soporte" },
  },
  ar: {
    text: `💜 <b>أتممنا شهرين. شكرًا لأنكم معنا</b>

قبل شهرين كان Cyber GPU Cluster مجرد فكرة. واليوم أصبح مجتمعًا حيًّا: مزارع تعمل كل يوم، وعمليات سحب، وأسئلتكم في الدردشة، واقتراحاتكم التي نطبّقها.

نعلم أن تيليغرام مليء بمشاريع تختفي بعد أسبوع. لذلك لا نطلب منكم أن تصدّقونا على كلامنا فقط:
✅ كل عملية سحب تُنشر في القناة العامة @CGPU_transactions مع رمز المعاملة (hash) — ويمكنكم التحقق منه على بلوكتشين TON
✅ أشخاص حقيقيون يردّون عليكم في الدعم @GPU_Support وفي دردشتنا @GPU_ChitChat

احتفالًا بهذه المناسبة الصغيرة، نهديكم <b>خصم 15% على جميع أجهزة التعدين</b> في المتجر — من Raspberry Neural Core حتى Dyson Swarm ASI Nexus.

⏱ العرض ساري ليوم واحد فقط — حتى 21 أكتوبر الساعة 00:00 بتوقيت UTC.
يُطبَّق الخصم تلقائيًا داخل التطبيق مباشرة. لا رموز ترويجية، ولا تحويلات لـ«مشرفين» في الرسائل الخاصة.

شكرًا لأنكم تكبرون معنا. والقادم أكثر 🚀

فريق Cyber GPU Cluster`,
    buttons: { market: "🛒 افتح المتجر −15%", channel: "📢 القناة", chat: "💬 الدردشة", payouts: "💸 السحوبات", support: "🛟 الدعم" },
  },
  id: {
    text: `💜 <b>Kami sudah 2 bulan. Terima kasih sudah bersama kami</b>

Dua bulan lalu, Cyber GPU Cluster hanyalah sebuah ide. Hari ini, ini adalah komunitas yang hidup: farm berjalan setiap hari, penarikan, pertanyaan kalian di chat, dan saran yang kami terapkan.

Kami tahu Telegram penuh dengan proyek yang menghilang dalam seminggu. Karena itu kami tidak meminta kalian percaya begitu saja:
✅ setiap penarikan dipublikasikan di channel publik @CGPU_transactions beserta hash transaksinya — bisa dicek langsung di blockchain TON
✅ orang sungguhan menjawab di @GPU_Support dan chat @GPU_ChitChat

Untuk merayakan momen kecil ini, kami memberikan <b>diskon 15% untuk semua miner</b> di Market — dari Raspberry Neural Core hingga Dyson Swarm ASI Nexus.

⏱ Promo berlaku 1 hari — hingga 21 Oktober, 07:00 WIB (00:00 UTC).
Diskon diterapkan otomatis, langsung di aplikasi. Tanpa kode promo, dan tanpa transfer ke "admin" lewat DM.

Terima kasih sudah tumbuh bersama kami. Masih banyak hal ke depan 🚀

Tim Cyber GPU Cluster`,
    buttons: { market: "🛒 Buka Market −15%", channel: "📢 Channel", chat: "💬 Chat", payouts: "💸 Penarikan", support: "🛟 Dukungan" },
  },
  tr: {
    text: `💜 <b>2 aylık olduk. Bizimle olduğunuz için teşekkürler</b>

İki ay önce Cyber GPU Cluster sadece bir fikirdi. Bugün ise yaşayan bir topluluk: her gün çalışan çiftlikler, para çekimleri, sohbette sorularınız ve uygulamaya eklediğimiz önerileriniz.

Telegram'da bir hafta içinde kaybolan pek çok proje olduğunu biliyoruz. Bu yüzden sadece sözümüze güvenmenizi istemiyoruz:
✅ her para çekimi, işlem hash'i ile birlikte herkese açık @CGPU_transactions kanalında yayınlanır — TON blokzincirinde kendiniz kontrol edebilirsiniz
✅ @GPU_Support ve @GPU_ChitChat sohbetinde gerçek insanlar yanıt veriyor

Bu küçük kutlamanın şerefine Market'teki <b>tüm madencilerde %15 indirim</b> hediye ediyoruz — Raspberry Neural Core'dan Dyson Swarm ASI Nexus'a kadar.

⏱ Kampanya 1 gün sürüyor — 21 Ekim, 03:00 TSİ'ye (00:00 UTC) kadar.
İndirim uygulamada otomatik olarak uygulanır. Promosyon kodu yok, özelden "adminlere" transfer yok.

Bizimle birlikte büyüdüğünüz için teşekkürler. Önümüzde daha çok şey var 🚀

Cyber GPU Cluster ekibi`,
    buttons: { market: "🛒 Marketi aç −%15", channel: "📢 Kanal", chat: "💬 Sohbet", payouts: "💸 Ödemeler", support: "🛟 Destek" },
  },
  kk: {
    text: `💜 <b>Бізге 2 ай толды. Бізбен бірге болғандарыңызға рақмет</b>

Екі ай бұрын Cyber GPU Cluster жай ғана идея еді. Бүгін бұл — тірі қауымдастық: фермалар күн сайын жұмыс істейді, қаражат шығарылады, чатта сұрақтарыңыз бен біз енгізіп жатқан ұсыныстарыңыз бар.

Telegram-да бір аптадан кейін жоғалып кететін жобалар көп екенін білеміз. Сондықтан бізге сөзбен сеніңіз деп сұрамаймыз:
✅ әрбір қаражат шығару транзакция хэшімен бірге ашық @CGPU_transactions арнасында жарияланады — оны TON блокчейнінде тексеруге болады
✅ @GPU_Support пен @GPU_ChitChat чатында нақты адамдар жауап береді

Шағын мерекеміздің құрметіне Маркеттегі <b>барлық майнерлерге 15% жеңілдік</b> сыйлаймыз — Raspberry Neural Core-дан Dyson Swarm ASI Nexus-қа дейін.

⏱ Акция 1 күн жүреді — 21 қазан, Астана уақытымен 05:00-ге (00:00 UTC) дейін.
Жеңілдік қолданбада автоматты түрде қолданылады. Ешқандай промокод жоқ, жеке хатта «админдерге» аударым да жоқ.

Бізбен бірге өскендеріңізге рақмет. Алда әлі көп нәрсе бар 🚀

Cyber GPU Cluster командасы`,
    buttons: { market: "🛒 Маркетті ашу −15%", channel: "📢 Арна", chat: "💬 Чат", payouts: "💸 Төлемдер", support: "🛟 Қолдау" },
  },
};

/**
 *  [ 🛒 Маркет −15%            ]
 *  [ 📢 Канал   ][ 💬 Чат       ]
 *  [ 💸 Виплати ][ 🛟 Підтримка ]
 */
function keyboard(buttons) {
  const b = (key) => ({ text: buttons[key], url: LINKS[key] });
  return { inline_keyboard: [[b("market")], [b("channel"), b("chat")], [b("payouts"), b("support")]] };
}

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
 * file_id, який повернув Telegram, — без повторного завантаження файлу.
 */
async function sendOne(telegramId, message, photo) {
  const replyMarkup = keyboard(message.buttons);
  let res;

  if (photo && photo.fileId) {
    res = await fetch(api("sendPhoto"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, photo: photo.fileId, caption: message.text, parse_mode: "HTML", reply_markup: replyMarkup }),
    });
  } else if (photo) {
    const form = new FormData();
    form.append("chat_id", String(telegramId));
    form.append("caption", message.text);
    form.append("parse_mode", "HTML");
    form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append("photo", new Blob([photo.bytes], { type: photo.mime }), path.basename(photo.path));
    res = await fetch(api("sendPhoto"), { method: "POST", body: form });
  } else {
    res = await fetch(api("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text: message.text, parse_mode: "HTML", reply_markup: replyMarkup, disable_web_page_preview: true }),
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

  for (const [lang, m] of Object.entries(MESSAGES)) {
    const visible = m.text.replace(/<[^>]+>/g, "").length;
    if (visible > 1024) throw new Error(`Caption for "${lang}" is ${visible} chars (limit 1024)`);
  }

  const rows = await sbAll(
    "profiles?select=telegram_id,telegram_language_code&is_bot_blocked=eq.false&order=created_at.asc",
  );
  const alreadySent = loadSent();
  const pending = rows.filter((r) => !alreadySent.has(String(r.telegram_id)));
  const queue = SKIP > 0 ? pending.slice(SKIP) : pending;
  // --only: тест на одну людину (навіть якщо вона вже в логу або позначена як недосяжна).
  const audience = ONLY
    ? [{ telegram_id: ONLY, telegram_language_code: FORCE_LANG ?? (await sb(`profiles?select=telegram_language_code&telegram_id=eq.${encodeURIComponent(ONLY)}`))[0]?.telegram_language_code }]
    : LIMIT
      ? queue.slice(0, LIMIT)
      : queue;

  let photo = null;
  if (PHOTO_PATH) {
    const bytes = fs.readFileSync(PHOTO_PATH);
    const mime = PHOTO_PATH.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    photo = { path: PHOTO_PATH, bytes, mime, fileId: null };
  }

  console.log(`Promo: ${campaign.slug} -${campaign.discount_percent}% until ${campaign.ends_at}`);
  console.log(`Reachable profiles (is_bot_blocked = false): ${rows.length}; already sent earlier: ${rows.length - pending.length}`);
  console.log(`Audience this run: ${audience.length}${SKIP ? ` (skip ${SKIP})` : ""}${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  console.log(`Photo: ${photo ? `${photo.path} (${(photo.bytes.length / 1024 / 1024).toFixed(2)} MB)` : "none — text only"}`);
  console.log("Links:", LINKS);
  console.log(`Rate: ${RATE_PER_SECOND}/s (gap ${GAP_MS}ms)`);

  const byLang = {};
  for (const r of audience) {
    const l = resolveLang(r.telegram_language_code);
    byLang[l] = (byLang[l] ?? 0) + 1;
  }
  console.log("By language:", byLang);
  console.log("Caption length:", Object.fromEntries(Object.entries(MESSAGES).map(([l, m]) => [l, m.text.replace(/<[^>]+>/g, "").length])));

  if (!SEND) {
    console.log("\nDRY RUN — nothing was sent. Add --send to send for real.");
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
        if (!ONLY) await markBotBlocked(row.telegram_id);
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

import "server-only";

/**
 * Читання вхідних транзакцій treasury-гаманця через публічний REST API
 * toncenter.com. Без TONCENTER_API_KEY працює, але з жорсткими лімітами —
 * для продакшену отримати ключ на https://toncenter.com/.
 *
 * ВАЖЛИВО: я не міг наживо протестувати цей шлях реальною ончейн-транзакцією
 * (немає фінансованого гаманця в цьому середовищі) — форма відповіді
 * toncenter відтворена за офіційною документацією API v2, але перед
 * продакшеном варто перевірити на реальному тестовому депозиті.
 */

export interface TreasuryTransaction {
  /** base64 transaction hash — те, що йде як p_tx_hash у process_successful_deposit */
  hash: string;
  utime: number;
  valueNanoTon: string;
  comment: string | null;
  sourceAddress: string | null;
}

interface ToncenterMessage {
  source?: string;
  destination?: string;
  value?: string;
  message?: string;
  msg_data?: { text?: string };
}

interface ToncenterTransaction {
  transaction_id?: { hash?: string; lt?: string };
  utime?: number;
  in_msg?: ToncenterMessage;
}

interface ToncenterGetTransactionsResponse {
  ok: boolean;
  result?: ToncenterTransaction[];
}

const TONCENTER_BASE_URL = "https://toncenter.com/api/v2";

// Розмір ОДНІЄЇ сторінки getTransactions — 100 (не 30), той самий запас, що
// був раніше при одноразовому фіксованому вікні. Тепер це вже не межа
// "скільки взагалі бачимо", а лише розмір кроку пагінації нижче.
const PAGE_SIZE = 100;

// Скільки сторінок максимум пройти за один виклик — safety cap, щоб один
// сплеск активності (чи баг у логіці зупинки) не перетворив запит на
// нескінченний цикл викликів до toncenter (rate-limit, зависання роуту).
// 20 сторінок × 100 = до 2000 транзакцій за один прохід — з великим запасом
// навіть для добового вікна /api/cron/deposits.
const DEFAULT_MAX_PAGES = 20;

export interface FetchTreasuryTransactionsOptions {
  /**
   * Пагінація зупиняється, щойно НАЙСТАРІША транзакція на поточній сторінці
   * старша за цей unix-час — тобто вікно гарантовано покрите ПОВНІСТЮ,
   * незалежно від того, скільки транзакцій у нього влізло (на відміну від
   * старого підходу з одним фіксованим limit, який міг "виштовхнути" ще не
   * знайдений матч під високим навантаженням — код-рев'ю зафіксувало це як
   * ризик "загублених" депозитів, не дубльованих). Без цього параметра
   * пагінація йде, доки не вичерпається історія або DEFAULT_MAX_PAGES.
   */
  sinceUtimeSeconds?: number;
  maxPages?: number;
}

/**
 * Пагінація через lt+hash останньої транзакції попередньої сторінки —
 * стандартний спосіб "гортати" історію toncenter getTransactions углиб
 * (сторінки йдуть від найновішої транзакції до найстарішої).
 *
 * ПЕРЕВІРЕНО НАЖИВО (реальні curl-запити до цієї ж treasury-адреси, не лише
 * за документацією): lt+hash як курсор — ВКЛЮЧНО, наступна сторінка повертає
 * САМУ транзакцію-курсор першим рядком, а не строго ПІСЛЯ неї. Тому кожну
 * сторінку, крім першої, обрізаємо на 1 елемент спереду нижче (pageResult) —
 * інакше кожен наступний виклик повертав би вже врахований рядок вдруге
 * (не ламає коректність — той самий tx_hash однаково відсіється нижче по
 * ланцюжку, — але даремно витрачає бюджет DEFAULT_MAX_PAGES).
 *
 * НЕ перевірено наживо (в історії цієї адреси лише 2 транзакції загалом,
 * недостатньо для реальної другої сторінки): чи рахується сама
 * транзакція-курсор проти ліміту `limit`, чи йде понад нього. Тому зупинку
 * пагінації навмисно НЕ прив'язую до точної арифметики "PAGE_SIZE (+1)" —
 * єдиний однозначний і безпечний за будь-якої відповіді на це питання сигнал
 * "історія вичерпана" — pageResult.length === 0 (ця сторінка не додала
 * жодного НОВОГО рядка понад те, що вже бачили). Найгірший наслідок
 * помилкового припущення про точну арифметику — один зайвий round-trip до
 * toncenter перед зупинкою, не пропущені й не задубльовані депозити.
 */
export async function fetchTreasuryTransactions(
  treasuryAddress: string,
  options: FetchTreasuryTransactionsOptions = {},
): Promise<TreasuryTransaction[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const apiKey = process.env.TONCENTER_API_KEY;

  const transactions: TreasuryTransaction[] = [];
  let cursor: { lt: string; hash: string } | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${TONCENTER_BASE_URL}/getTransactions`);
    url.searchParams.set("address", treasuryAddress);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("archival", "false");
    if (apiKey) url.searchParams.set("api_key", apiKey);
    if (cursor) {
      url.searchParams.set("lt", cursor.lt);
      url.searchParams.set("hash", cursor.hash);
    }

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`toncenter request failed with status ${res.status}`);
    }

    const body = (await res.json()) as ToncenterGetTransactionsResponse;
    if (!body.ok || !Array.isArray(body.result)) {
      throw new Error("toncenter returned an unexpected response shape");
    }

    // З другої сторінки й далі перший рядок — це той самий tx, яким
    // закінчилась попередня сторінка (курсор включно, див. коментар вище).
    const pageResult = cursor ? body.result.slice(1) : body.result;
    if (pageResult.length === 0) break; // ця сторінка не додала нічого нового — кінець історії

    let oldestUtimeOnPage = Infinity;
    let lastLt: string | undefined;
    let lastHash: string | undefined;

    for (const tx of pageResult) {
      const hash = tx.transaction_id?.hash;
      const lt = tx.transaction_id?.lt;
      const utime = tx.utime ?? 0;

      // Курсор для наступної сторінки веду по КОЖНІЙ транзакції з валідним
      // (lt, hash), навіть якщо tx.in_msg відсутній (сама транзакція не
      // депозит, напр. вихідна виплата скарбниці) — інакше пропуск таких
      // рядків зламав би послідовність пагінації.
      if (lt && hash) {
        lastLt = lt;
        lastHash = hash;
      }
      if (utime < oldestUtimeOnPage) oldestUtimeOnPage = utime;

      if (!hash || !tx.in_msg) continue;

      transactions.push({
        hash,
        utime,
        valueNanoTon: tx.in_msg.value ?? "0",
        comment: tx.in_msg.message ?? tx.in_msg.msg_data?.text ?? null,
        sourceAddress: tx.in_msg.source ?? null,
      });
    }

    const coveredWindow =
      options.sinceUtimeSeconds !== undefined && oldestUtimeOnPage < options.sinceUtimeSeconds;
    if (coveredWindow || !lastLt || !lastHash) break;

    cursor = { lt: lastLt, hash: lastHash };
  }

  return options.sinceUtimeSeconds !== undefined
    ? transactions.filter((tx) => tx.utime >= (options.sinceUtimeSeconds as number))
    : transactions;
}

/**
 * Парсить коментар транзакції як telegram_id — приймає ЛИШЕ рядок з самих
 * цифр (після trim), інакше null. Навмисно суворо: жодних префіксів чи
 * додаткового тексту довкола числа, щоб не зачепити випадковий сторонній
 * коментар, що містить якісь цифри не за темою.
 */
export function parseTelegramIdFromComment(comment: string | null): number | null {
  if (!comment) return null;
  const trimmed = comment.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Усі транзакції на treasury, чий коментар парситься рівно як цей
 * telegram_id — на відміну від старої (dep_<uuid>_<nonce>) схеми, коментар
 * тепер СТАТИЧНИЙ на користувача, тож законно може збігтись у кількох
 * окремих реальних депозитах одразу; повертаємо їх УСІ (не перший-ліпший).
 * sinceUtimeSeconds (опційно) — відкидає транзакції старіші за цей unix-час,
 * для "перевір мій платіж за останні N хвилин" (DepositModal, ручна кнопка).
 */
export function findDepositTransactionsForTelegramId(
  transactions: TreasuryTransaction[],
  telegramId: number,
  sinceUtimeSeconds?: number,
): TreasuryTransaction[] {
  return transactions.filter((tx) => {
    if (parseTelegramIdFromComment(tx.comment) !== telegramId) return false;
    if (sinceUtimeSeconds !== undefined && tx.utime < sinceUtimeSeconds) return false;
    return true;
  });
}

export function nanoTonToTon(nanoTon: string): number {
  return Number(BigInt(nanoTon)) / 1_000_000_000;
}

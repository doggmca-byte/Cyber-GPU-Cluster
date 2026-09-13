import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, handleRouteError } from "@/lib/api/errors";
import { fetchTreasuryTransactions } from "@/lib/ton/deposit";
import { creditMatchingDeposits } from "@/lib/wallet/depositMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Фоновий воркер автозарахування депозитів — сканує ОСТАННІ транзакції на
 * treasury (без прив'язки до конкретного telegram_id, на відміну від
 * /api/wallet/deposit/check і /api/admin/deposits/reconcile) і зараховує все,
 * що ще не в БД. Це реальний "не залежить від того, чи хтось відкрив
 * застосунок" запобіжник для сценарію, коли користувач заплатив з
 * зовнішнього гаманця й ніколи не повернувся натиснути "Перевірити оплату".
 *
 * Триґериться Vercel Cron (vercel.json) кожні 5 хвилин. Раніше тут стояло
 * "0 3 * * *" — раз на добу о 03:00 UTC — не з дизайну, а через Hobby-план,
 * де крони обмежені одним запуском на добу (частіший розклад там просто
 * відхиляється при деплої). На Pro-плані крони ходять щохвилини, тож
 * "загублений" переказ тепер чекає щонайбільше 5 хвилин замість майже доби.
 *
 * Це все ще бекстоп: основний шлях — автоматичний поллінг одразу після
 * TonConnect-переказу, ручна кнопка "Перевірити оплату" в DepositModal і
 * опортуністичний скан при відкритті застосунку. Усі троє спрацьовують
 * швидше за цей крон.
 *
 * Vercel автоматично додає заголовок Authorization: Bearer $CRON_SECRET до
 * власних cron-викликів, коли ENV CRON_SECRET заданий — перевіряємо це, щоб
 * роут не можна було безкарно смикати ззовні (зайве навантаження на
 * toncenter rate-limit — не критична діра, бо process_successful_deposit і
 * так захищений унікальним tx_hash, але немає причин лишати це публічним).
 * Fail-closed: якщо CRON_SECRET взагалі не заданий — роут відмовляє 500-кою,
 * а не тихо працює без захисту (задай CRON_SECRET і в .env, і в Vercel
 * Dashboard ПЕРЕД тим, як додавати cron у vercel.json на проді).
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      throw new ApiError(500, "server misconfigured: CRON_SECRET is not set");
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new ApiError(401, "unauthorized");
    }

    const admin = createAdminClient();
    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_TON_ADDRESS;
    if (!treasuryAddress) {
      throw new ApiError(500, "server misconfigured: NEXT_PUBLIC_TREASURY_TON_ADDRESS is not set");
    }

    // Вікно навмисно ширше за інтервал крона (5 хв): якщо деплой, збій
    // toncenter чи пауза проєкту з'їли кілька прогонів, наступний однаково
    // підбере все, що впало за добу. Ширина вікна тут майже безкоштовна —
    // fetchTreasuryTransactions (lib/ton/deposit.ts) гортає рівно стільки
    // сторінок toncenter, скільки треба, щоб його покрити, а трафіку на
    // скарбниці одиниці транзакцій на добу.
    const sinceUtimeSeconds = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const transactions = await fetchTreasuryTransactions(treasuryAddress, { sinceUtimeSeconds });
    const credited = await creditMatchingDeposits(admin, transactions);

    if (credited.length > 0) {
      console.log(`[cron/deposits] credited ${credited.length} deposit(s):`, credited);
    }

    return NextResponse.json({
      scanned: transactions.length,
      credited_count: credited.length,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { beginCell } from "@ton/core";

/** TON-коментар до переказу: opcode 0x00000000 + UTF-8 текст, серіалізовано в BOC (base64). */
export function buildCommentPayload(comment: string): string {
  const cell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
  return cell.toBoc().toString("base64");
}

/**
 * Memo/коментар депозиту — рівно telegram_id користувача, нічого більше
 * (жодного префіксу/nonce). Це навмисно СТАТИЧНЕ значення для одного й того
 * самого користувача, а не одноразовий токен, як було раніше (dep_<uuid>_
 * <nonce>) — той самий підхід, що й у типових memo-based депозитах на
 * біржах (Binance UID тощо): будь-яка вхідна транзакція на скарбницю з цим
 * коментарем розпізнається як депозит цього користувача, незалежно від того,
 * з якого гаманця й коли вона надіслана (lib/ton/deposit.ts
 * findDepositTransactionsForTelegramId + lib/wallet/depositMatching.ts).
 *
 * Унікальність зарахування забезпечує НЕ унікальність коментаря (він
 * навмисно один і той самий на кожен переказ), а унікальний індекс на
 * tx_hash у process_successful_deposit — кожна ончейн-транзакція
 * зараховується рівно один раз.
 */
export function buildDepositMemo(telegramId: number | string): string {
  return String(telegramId).trim();
}

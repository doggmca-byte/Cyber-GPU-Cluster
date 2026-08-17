import { beginCell } from "@ton/core";

/** TON-коментар до переказу: opcode 0x00000000 + UTF-8 текст, серіалізовано в BOC (base64). */
export function buildCommentPayload(comment: string): string {
  const cell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
  return cell.toBoc().toString("base64");
}

/** Короткий випадковий nonce, щоб кожна спроба депозиту мала унікальний коментар. */
export function randomDepositNonce(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDepositComment(profileId: string): string {
  return `dep_${profileId}_${randomDepositNonce()}`;
}

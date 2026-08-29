/** Мінімальний зріз Telegram Bot API Update — лише поля, які реально читає app/api/telegram/webhook. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramIncomingMessage;
}

export interface TelegramIncomingMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; language_code?: string };
}

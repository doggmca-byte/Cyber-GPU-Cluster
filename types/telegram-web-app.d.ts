export {};

interface TelegramWebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  /** true, якщо юзер УЖЕ дозволив боту писати йому (Bot API 6.9+) — джерело правди саме Telegram, не наш власний стан. */
  allows_write_to_pm?: boolean;
}

interface TelegramWebAppInitDataUnsafe {
  user?: TelegramWebAppUser;
  start_param?: string;
  auth_date?: number;
  hash?: string;
  [key: string]: unknown;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramWebAppInitDataUnsafe;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  colorScheme?: "light" | "dark";
  /**
   * Показує нативний діалог Telegram "Дозволити цьому боту писати вам?" —
   * НЕ показує вдруге, якщо юзер уже дозволив раніше (Telegram сам це
   * пам'ятає, ідемпотентно). callback отримує granted:boolean.
   */
  requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, parseAdminSessionValue } from "@/lib/admin/session";
import { isTelegramAdmin } from "@/lib/admin/telegramAdmins";

// /admin (сторінка) навмисно НЕ гейтиться тут — вона сама показує коректний
// UI-стан (checking / access-denied / потрібен Telegram / панель), а без
// успішної авторизації жодних даних однаково не завантажує (усі дані йдуть
// через захищені нижче API). /api/admin/telegram-login — єдина публічна
// ручка, вона САМА видає сесію, тому не може вимагати вже наявної сесії.
// /api/admin/logout завжди має бути доступний (ідемпотентний вихід).
const PUBLIC_ADMIN_API_PATHS = new Set(["/api/admin/telegram-login", "/api/admin/logout"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/admin") || PUBLIC_ADMIN_API_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const parsed = await parseAdminSessionValue(session);

  if (parsed && isTelegramAdmin(parsed.telegramId)) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: "admin authentication required" }, { status: 401 });
}

export const config = {
  matcher: ["/api/admin/:path*"],
};

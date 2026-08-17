import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * public/tonconnect-manifest.json НЕ підходить — статичні файли в public/ не
 * проходять через env-підстановку Next.js, а на кожному Vercel-оточенні
 * (preview/prod) NEXT_PUBLIC_APP_URL різний. Тому маніфест — динамічний роут:
 * ті самі мобільні гаманці (Tonkeeper, Telegram Wallet), що фетчать його
 * напряму по абсолютному URL, завжди отримають актуальний origin.
 */
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";

  return NextResponse.json({
    url: appUrl,
    name: "Cyber GPU Cluster",
    iconUrl: `${appUrl}/icon.png`,
    termsOfUseUrl: "",
    privacyPolicyUrl: "",
  });
}

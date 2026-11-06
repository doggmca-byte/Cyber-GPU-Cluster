/**
 * Ідентифікатор збірки — запасний варіант для /api/version поза Vercel
 * (на Vercel там VERCEL_DEPLOYMENT_ID). Клієнт його НЕ використовує: Next
 * обчислює цей конфіг окремо для серверної й клієнтської компіляції, і
 * Date.now() у них розходиться на десятки секунд — порівняння "вшитого" в
 * бандл значення з серверним давало б хибний "новий деплой" щоразу.
 */
const nextConfig = {
  // the unhashed icon of the public folder is cached for a day instead of being asked for again at every open
  async headers() {
    return [{ source: "/icon-512.png", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] }];
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: String(Date.now()),
  },
};

export default nextConfig;

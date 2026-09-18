/**
 * Ідентифікатор збірки — запасний варіант для /api/version поза Vercel
 * (на Vercel там VERCEL_DEPLOYMENT_ID). Клієнт його НЕ використовує: Next
 * обчислює цей конфіг окремо для серверної й клієнтської компіляції, і
 * Date.now() у них розходиться на десятки секунд — порівняння "вшитого" в
 * бандл значення з серверним давало б хибний "новий деплой" щоразу.
 */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: String(Date.now()),
  },
};

export default nextConfig;

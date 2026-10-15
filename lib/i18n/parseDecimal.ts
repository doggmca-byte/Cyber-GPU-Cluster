/**
 * Поля сум — type="text" + inputMode="decimal", а НЕ type="number".
 *
 * Причина: на iOS (і в частині Android-клавіатур) з регіоном, де десятковий
 * роздільник — кома (ru/uk/es/fr/tr/id/…), клавіатура decimal показує лише ",".
 * Поле type="number" на "0,1" віддає value === "" — сума "зникає", кнопка
 * лишається неактивною без жодної підказки, і запит навіть не йде на сервер.
 * Саме так гравці не могли поставити вивід 0.1 TON.
 *
 * Тому нормалізуємо введення самі: кома/арабська кома -> крапка, арабсько-індійські
 * та перські цифри -> ASCII, решта символів відкидається, лишається один роздільник.
 */
export function normalizeDecimalInput(raw: string): string {
  const ascii = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,٫]/g, ".")
    .replace(/[^\d.]/g, "");

  const dot = ascii.indexOf(".");
  return dot === -1 ? ascii : ascii.slice(0, dot + 1) + ascii.slice(dot + 1).replace(/\./g, "");
}

/** Число з уже нормалізованого рядка; NaN для порожнього/неповного ("", "."). */
export function parseDecimalInput(value: string): number {
  if (value === "" || value === ".") return NaN;
  return Number(value);
}

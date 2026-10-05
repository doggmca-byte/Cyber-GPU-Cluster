import "server-only";
import { deflateSync } from "node:zlib";
import { randomInt } from "node:crypto";

/**
 * Генератор пазл-капчі без залежностей (жодного sharp/canvas): малюємо пікселі
 * самі й пакуємо в PNG через node:zlib.
 *
 * Картинка — смуга LW x LH логічних px (рендер у SCALE разів чіткіше) з трьома
 * "ділянками" різної форми. Уламок має форму й візерунок РІВНО однієї з них;
 * гравець перетягує уламок із лівого краю на потрібну ділянку.
 *
 * Правильна відповідь (центр ділянки по X) повертається окремо від картинок і
 * живе лише на сервері — у браузер вона не потрапляє ні в якому вигляді.
 */

export const CAPTCHA_LOGICAL_WIDTH = 340;
export const CAPTCHA_LOGICAL_HEIGHT = 84;
export const CAPTCHA_PIECE_SIZE = 56;
/** Центр уламка (по X), з якого гравець починає тягнути. */
export const CAPTCHA_START_X = 34;
/** Допуск збігу центру уламка з центром ділянки, логічні px. */
export const CAPTCHA_TOLERANCE = 13;

const SCALE = 2;
const SLOT_CENTERS = [132, 212, 292];
const SLOT_JITTER = 6;

type Vec = readonly [number, number];
type Sdf = (x: number, y: number) => number;

interface ShapeDef {
  id: string;
  sdf: Sdf;
}

function rotated(sdf: Sdf, angle: number): Sdf {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (x, y) => sdf(x * c + y * s, -x * s + y * c);
}

function sdCircle(r: number): Sdf {
  return (x, y) => Math.hypot(x, y) - r;
}

function sdRoundedBox(half: number, radius: number): Sdf {
  return (x, y) => {
    const qx = Math.abs(x) - (half - radius);
    const qy = Math.abs(y) - (half - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
}

function sdPolygon(points: Vec[]): Sdf {
  const n = points.length;
  return (px, py) => {
    let d = (px - points[0][0]) ** 2 + (py - points[0][1]) ** 2;
    let sign = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const ex = points[j][0] - points[i][0];
      const ey = points[j][1] - points[i][1];
      const wx = px - points[i][0];
      const wy = py - points[i][1];
      const t = Math.min(Math.max((wx * ex + wy * ey) / (ex * ex + ey * ey), 0), 1);
      const bx = wx - ex * t;
      const by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      const c1 = py >= points[i][1];
      const c2 = py < points[j][1];
      const c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
    }
    return sign * Math.sqrt(d);
  };
}

function regularPolygon(sides: number, radius: number): Vec[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
  });
}

function starPolygon(outer: number, inner: number): Vec[] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
}

/** Класичний елемент пазла: квадрат із круглим "язичком" на одній зі сторін. */
function sdJigsaw(side: number): Sdf {
  const box = sdRoundedBox(17, 3);
  const tab = sdCircle(8);
  const base: Sdf = (x, y) => Math.min(box(x, y), tab(x - 22, y));
  return rotated(base, (Math.PI / 2) * side);
}

function sdPlus(): Sdf {
  const a = sdRoundedBox(8, 2);
  return (x, y) => {
    const arm = (u: number, v: number) => {
      const qx = Math.abs(u) - 22 + 8;
      const qy = Math.abs(v) - 8 + 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 2;
    };
    return Math.min(arm(x, y), arm(y, x), a(x, y));
  };
}

function buildShape(id: string, rotation: number): ShapeDef {
  switch (id) {
    case "circle":
      return { id, sdf: sdCircle(22) };
    case "box":
      return { id, sdf: rotated(sdRoundedBox(19, 6), rotation) };
    case "diamond":
      return { id, sdf: rotated(sdRoundedBox(17, 2), Math.PI / 4) };
    case "hexagon":
      return { id, sdf: rotated(sdPolygon(regularPolygon(6, 24)), rotation) };
    case "star":
      return { id, sdf: rotated(sdPolygon(starPolygon(25, 11)), rotation) };
    case "triangle":
      return { id, sdf: rotated(sdPolygon(regularPolygon(3, 26)), rotation) };
    case "plus":
      return { id, sdf: rotated(sdPlus(), rotation) };
    default: {
      const side = Number(id.replace("jigsaw", ""));
      return { id, sdf: sdJigsaw(side) };
    }
  }
}

const SHAPE_IDS = [
  "circle",
  "box",
  "diamond",
  "hexagon",
  "star",
  "triangle",
  "plus",
  "jigsaw0",
  "jigsaw1",
  "jigsaw2",
  "jigsaw3",
];

function rand(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function between(min: number, max: number): number {
  return min + rand() * (max - min);
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

interface Distractor {
  cx: number;
  cy: number;
  sdf: Sdf;
  alpha: number;
  bright: number;
  ring: boolean;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** channels: 3 (RGB) або 4 (RGBA). Фільтр Sub — гладкі градієнти стискаються у рази краще. */
function encodePng(width: number, height: number, channels: 3 | 4, pixels: Uint8Array): Buffer {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1;
    for (let i = 0; i < stride; i += 1) {
      const cur = pixels[y * stride + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      raw[rowStart + 1 + i] = (cur - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- рендер

export interface CaptchaRender {
  background: string; // data URI (PNG)
  piece: string; // data URI (PNG, прозорий)
  answerX: number; // центр правильної ділянки, логічні px
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const coverage = (d: number) => Math.min(1, Math.max(0, 0.5 - d * SCALE));

export function renderCaptcha(): CaptchaRender {
  const pxW = CAPTCHA_LOGICAL_WIDTH * SCALE;
  const pxH = CAPTCHA_LOGICAL_HEIGHT * SCALE;

  // --- форми: правильна + дві різні хибні
  const [correctId, decoyA, decoyB] = shuffled(SHAPE_IDS);
  const correct = buildShape(correctId, between(0, Math.PI * 2));
  const decoys = [buildShape(decoyA, between(0, Math.PI * 2)), buildShape(decoyB, between(0, Math.PI * 2))];
  const correctSlot = randomInt(0, 3);
  const holes = SLOT_CENTERS.map((center, i) => ({
    cx: center + between(-SLOT_JITTER, SLOT_JITTER),
    cy: CAPTCHA_LOGICAL_HEIGHT / 2 + between(-4, 4),
    shape: i === correctSlot ? correct : decoys[i > correctSlot ? i - 1 : i],
  }));
  const answer = holes[correctSlot];

  // --- фон: градієнт + смуги-візерунок + напівпрозорі "уламки"
  const hue = between(0, 360);
  const c1 = hsl(hue, 0.55, 0.55);
  const c2 = hsl((hue + between(50, 130)) % 360, 0.6, 0.45);
  const gradAngle = between(0, Math.PI);
  const stripeAngle = between(0, Math.PI);
  const stripeFreq = between(0.35, 0.8);
  const stripeAmp = between(10, 22);
  const gx = Math.cos(gradAngle);
  const gy = Math.sin(gradAngle);
  const sx = Math.cos(stripeAngle);
  const sy = Math.sin(stripeAngle);

  const distractors: Distractor[] = Array.from({ length: 16 }, () => {
    const r = between(5, 15);
    const kind = randomInt(0, 3);
    const rot = between(0, Math.PI * 2);
    const sdf =
      kind === 0 ? sdCircle(r) : kind === 1 ? rotated(sdRoundedBox(r, 2), rot) : rotated(sdPolygon(regularPolygon(3, r * 1.2)), rot);
    return {
      cx: between(0, CAPTCHA_LOGICAL_WIDTH),
      cy: between(0, CAPTCHA_LOGICAL_HEIGHT),
      sdf,
      alpha: between(0.1, 0.26),
      bright: rand() > 0.5 ? 255 : 0,
      ring: rand() > 0.6,
    };
  });

  const base = new Float32Array(pxW * pxH * 3);
  for (let py = 0; py < pxH; py += 1) {
    for (let px = 0; px < pxW; px += 1) {
      const x = (px + 0.5) / SCALE;
      const y = (py + 0.5) / SCALE;
      const t = Math.min(1, Math.max(0, ((x - 170) * gx + (y - 42) * gy) / 260 + 0.5));
      const stripe = Math.sin((x * sx + y * sy) * stripeFreq) * stripeAmp;
      let r = c1[0] + (c2[0] - c1[0]) * t + stripe;
      let g = c1[1] + (c2[1] - c1[1]) * t + stripe;
      let b = c1[2] + (c2[2] - c1[2]) * t + stripe;
      for (const dis of distractors) {
        const d = dis.sdf(x - dis.cx, y - dis.cy);
        const a = (dis.ring ? Math.max(0, 1 - Math.abs(d + 1) * 1.2) : coverage(d)) * dis.alpha;
        if (a > 0) {
          r += (dis.bright - r) * a;
          g += (dis.bright - g) * a;
          b += (dis.bright - b) * a;
        }
      }
      const o = (py * pxW + px) * 3;
      base[o] = r;
      base[o + 1] = g;
      base[o + 2] = b;
    }
  }

  // --- уламок: пікселі фону в місці правильної ділянки
  const pieceSize = CAPTCHA_PIECE_SIZE * SCALE;
  const piece = new Uint8Array(pieceSize * pieceSize * 4);
  for (let py = 0; py < pieceSize; py += 1) {
    for (let px = 0; px < pieceSize; px += 1) {
      const lx = (px + 0.5) / SCALE - CAPTCHA_PIECE_SIZE / 2;
      const ly = (py + 0.5) / SCALE - CAPTCHA_PIECE_SIZE / 2;
      const d = answer.shape.sdf(lx, ly);
      const a = coverage(d);
      if (a <= 0) continue;
      const bx = Math.min(pxW - 1, Math.max(0, Math.round((answer.cx + lx) * SCALE)));
      const by = Math.min(pxH - 1, Math.max(0, Math.round((answer.cy + ly) * SCALE)));
      const o = (by * pxW + bx) * 3;
      // світла окантовка + легка внутрішня підсвітка біля краю
      const edge = Math.max(0, 1 - Math.abs(d + 0.8) * 0.9) * 0.85;
      const q = (py * pieceSize + px) * 4;
      piece[q] = clamp255(base[o] + (255 - base[o]) * edge);
      piece[q + 1] = clamp255(base[o + 1] + (255 - base[o + 1]) * edge);
      piece[q + 2] = clamp255(base[o + 2] + (255 - base[o + 2]) * edge);
      piece[q + 3] = Math.round(a * 255);
    }
  }

  // --- вирізаємо ділянки у фоні (всі три однаково — "затемнена" ямка)
  for (let py = 0; py < pxH; py += 1) {
    for (let px = 0; px < pxW; px += 1) {
      const x = (px + 0.5) / SCALE;
      const y = (py + 0.5) / SCALE;
      const o = (py * pxW + px) * 3;
      for (const hole of holes) {
        const d = hole.shape.sdf(x - hole.cx, y - hole.cy);
        if (d > 1) continue;
        const a = coverage(d);
        const inner = d < 0 ? Math.max(0, 1 + d / 4) : 0; // темніше ближче до краю
        const dark = 0.5 - 0.18 * inner;
        const rim = Math.max(0, 1 - Math.abs(d) * 1.1) * 0.5;
        for (let k = 0; k < 3; k += 1) {
          const v = base[o + k];
          const carved = v * dark + rim * (255 - v * dark);
          base[o + k] = v + (carved - v) * Math.max(a, rim > 0 ? 0.6 : 0);
        }
      }
    }
  }

  const rgb = new Uint8Array(pxW * pxH * 3);
  for (let i = 0; i < rgb.length; i += 1) rgb[i] = clamp255(Math.round(base[i]));

  const toUri = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
  return {
    background: toUri(encodePng(pxW, pxH, 3, rgb)),
    piece: toUri(encodePng(pieceSize, pieceSize, 4, piece)),
    answerX: Math.round(answer.cx),
  };
}

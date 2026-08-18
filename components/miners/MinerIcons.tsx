"use client";

/**
 * Унікальні неонові SVG-іконки для кожного з 10 рівнів gpu_templates
 * (Cyberpunk / Neon Blueprint: тонкі схематичні контури + glow).
 *
 * Прив'язка не за вигаданими `id`/`type` (їх немає в схемі — gpu_templates
 * має лише `level`/`name`/`rarity`), а за реальними полями:
 *  - `level` (1..10) обирає ФОРМУ — кожен рівень має власний, впізнаваний
 *    силует, що відповідає темі його назви (Raspberry Neural Core → плата
 *    з GPIO, RTX 4090 AI Node → флагманська карта з тензор-сіткою тощо).
 *  - `rarity` обирає КОЛІР світіння — та сама рarity-шкала, що вже показана
 *    бейджем поруч (MarketScreen.RARITY_COLOR/FarmScreen), тож іконка й
 *    бейдж завжди узгоджені.
 *
 * Увесь модуль — чисті детерміновані SVG-примітиви (жодних дат/рандому/
 * window), тож гідратаційних розбіжностей SSR↔CSR тут структурно бути не
 * може.
 */

const RARITY_COLOR_HEX: Record<string, string> = {
  common: "#00F0FF",
  uncommon: "#00F0FF",
  rare: "#3B82F6",
  elite: "#3B82F6",
  epic: "#10B981",
  legendary: "#10B981",
  mythic: "#A855F7",
  ancient: "#A855F7",
  divine: "#FFB800",
  transcendent: "#FFB800",
};

const DEFAULT_COLOR = "#00F0FF";

function colorForRarity(rarity: string | null | undefined): string {
  if (!rarity) return DEFAULT_COLOR;
  return RARITY_COLOR_HEX[rarity] ?? DEFAULT_COLOR;
}

// --- Форми (level → glyph), 48x48 viewBox --------------------------------

/** LV.1 Raspberry Neural Core — плата мікрокомп'ютера з GPIO та нейро-чипом. */
function RaspberryCoreGlyph() {
  return (
    <>
      {[10, 14, 18, 22, 26, 30, 34, 38].map((x) => (
        <line key={x} x1={x} y1="4" x2={x} y2="10" strokeWidth="1.6" />
      ))}
      <rect x="7" y="10" width="34" height="30" rx="2.5" strokeWidth="1.8" />
      <circle cx="11" cy="14" r="1.2" strokeWidth="1.2" />
      <circle cx="37" cy="14" r="1.2" strokeWidth="1.2" />
      <circle cx="11" cy="36" r="1.2" strokeWidth="1.2" />
      <circle cx="37" cy="36" r="1.2" strokeWidth="1.2" />
      <rect x="16" y="18" width="16" height="14" rx="1.5" strokeWidth="1.6" />
      <circle cx="24" cy="25" r="2.4" fill="currentColor" fillOpacity="0.85" />
      <path d="M16 25H10M32 25h6M24 18v-4M24 32v4" strokeWidth="1.2" strokeLinecap="round" />
    </>
  );
}

/** LV.2 GTX Dual Farm — дві здвоєні відеокарти з кулерами. */
function GtxDualGlyph() {
  return (
    <>
      <rect x="5" y="10" width="27" height="12" rx="2" strokeWidth="1.7" />
      <circle cx="11" cy="16" r="3.2" strokeWidth="1.4" />
      <circle cx="20" cy="16" r="3.2" strokeWidth="1.4" />
      <path d="M32 13h5M32 19h5" strokeWidth="1.3" strokeLinecap="round" />

      <rect x="16" y="26" width="27" height="12" rx="2" strokeWidth="1.7" />
      <circle cx="23" cy="32" r="3.2" strokeWidth="1.4" />
      <circle cx="32" cy="32" r="3.2" strokeWidth="1.4" />
      <path d="M16 29h-5M16 35h-5" strokeWidth="1.3" strokeLinecap="round" />
    </>
  );
}

/** LV.3 RTX 4090 AI Node — флагманська карта з тензорною сіткою. */
function RtxAiNodeGlyph() {
  return (
    <>
      <rect x="4" y="16" width="40" height="16" rx="3" strokeWidth="1.8" />
      <circle cx="13" cy="24" r="4.2" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="4.2" strokeWidth="1.4" />
      <circle cx="35" cy="24" r="4.2" strokeWidth="1.4" />
      <path d="M8 32v4M14 32v4M20 32v4M28 32v4M34 32v4M40 32v4" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="17" y="6" width="14" height="7" rx="1" strokeWidth="1.1" />
      <line x1="21.6" y1="6" x2="21.6" y2="13" strokeWidth="1.1" />
      <line x1="26.3" y1="6" x2="26.3" y2="13" strokeWidth="1.1" />
      <line x1="17" y1="9.5" x2="31" y2="9.5" strokeWidth="1.1" />
    </>
  );
}

/** LV.4 Apple M-Max Cluster — унібоді SoC-чип з мінімалістичною сіткою пінів. */
function AppleMMaxGlyph() {
  return (
    <>
      <rect x="12" y="12" width="24" height="24" rx="6" strokeWidth="1.8" />
      <path
        d="M12 18H6M12 30H6M36 18h6M36 30h6M18 12V6M30 12V6M18 36v6M30 36v6"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="19" cy="19" r="1" fill="currentColor" />
      <circle cx="24" cy="19" r="1" fill="currentColor" />
      <circle cx="29" cy="19" r="1" fill="currentColor" />
      <circle cx="19" cy="24" r="1" fill="currentColor" />
      <circle cx="24" cy="24" r="1.6" fill="currentColor" />
      <circle cx="29" cy="24" r="1" fill="currentColor" />
      <circle cx="19" cy="29" r="1" fill="currentColor" />
      <circle cx="24" cy="29" r="1" fill="currentColor" />
      <circle cx="29" cy="29" r="1" fill="currentColor" />
    </>
  );
}

/** LV.5 Tensor Core V100 — чип із тензорною матрицею й ядром, що світиться. */
function TensorV100Glyph() {
  return (
    <>
      <rect x="9" y="9" width="30" height="30" rx="2" strokeWidth="1.8" />
      <path d="M16 9v30M24 9v30M32 9v30M9 16h30M9 24h30M9 32h30" strokeWidth="0.9" strokeOpacity="0.55" />
      <circle cx="24" cy="24" r="4.5" strokeWidth="1.6" />
      <circle cx="24" cy="24" r="1.8" fill="currentColor" />
    </>
  );
}

/** LV.6 NVIDIA A100 Substation — блейд-підстанція з дай-модулями та рейками. */
function A100SubstationGlyph() {
  return (
    <>
      <rect x="6" y="7" width="36" height="10" rx="1.5" strokeWidth="1.7" />
      <rect x="6" y="21" width="36" height="10" rx="1.5" strokeWidth="1.7" />
      <rect x="10" y="10" width="5" height="4" strokeWidth="1.1" />
      <rect x="18" y="10" width="5" height="4" strokeWidth="1.1" />
      <rect x="26" y="10" width="5" height="4" strokeWidth="1.1" />
      <rect x="10" y="24" width="5" height="4" strokeWidth="1.1" />
      <rect x="18" y="24" width="5" height="4" strokeWidth="1.1" />
      <rect x="26" y="24" width="5" height="4" strokeWidth="1.1" />
      <path d="M9 17v4M39 17v4M12 31v6M36 31v6" strokeWidth="1.4" strokeLinecap="round" />
    </>
  );
}

/** LV.7 H100 Sovereign Cloud — щит-гексагон із короною й чипом всередині. */
function H100SovereignGlyph() {
  return (
    <>
      <path d="M24 5 40 14v20L24 43 8 34V14z" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 10l2 4 3-3M32 10l-2 4-3-3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="18" y="19" width="12" height="10" rx="1.5" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="1.6" fill="currentColor" />
    </>
  );
}

/** LV.8 Blackwell B200 Supernode — два дай-чипи з інтерконнект-мостом. */
function BlackwellB200Glyph() {
  return (
    <>
      <rect x="5" y="15" width="16" height="16" rx="2" strokeWidth="1.7" />
      <rect x="27" y="15" width="16" height="16" rx="2" strokeWidth="1.7" />
      <rect x="19" y="20" width="10" height="6" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <path d="M9 31v5M13 31v5M17 31v5M31 31v5M35 31v5M39 31v5" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="13" cy="23" r="1.4" fill="currentColor" />
      <circle cx="35" cy="23" r="1.4" fill="currentColor" />
    </>
  );
}

/** LV.9 Quantum Cryo-Qubit — кубіт-ядро з орбіталями та кріо-акцентами. */
function QuantumQubitGlyph() {
  return (
    <>
      <ellipse cx="24" cy="24" rx="16" ry="7" strokeWidth="1.5" />
      <ellipse cx="24" cy="24" rx="16" ry="7" strokeWidth="1.5" transform="rotate(60 24 24)" />
      <ellipse cx="24" cy="24" rx="16" ry="7" strokeWidth="1.5" transform="rotate(120 24 24)" />
      <circle cx="24" cy="24" r="3.4" fill="currentColor" />
      <path d="M24 6v4M24 38v4M6 24h4M38 24h4" strokeWidth="1.1" strokeLinecap="round" strokeOpacity="0.6" />
    </>
  );
}

/** LV.10 Dyson Swarm ASI Nexus — рій-орбіта навколо ядра-зорі. */
function DysonSwarmGlyph() {
  const nodes = [0, 60, 120, 180, 240, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: 24 + 18 * Math.cos(rad), y: 24 + 18 * Math.sin(rad) };
  });
  return (
    <>
      <circle cx="24" cy="24" r="18" strokeWidth="1.3" strokeDasharray="2 3.2" />
      <circle cx="24" cy="24" r="8" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="4" fill="currentColor" />
      {nodes.map((n) => (
        <circle key={`${n.x}-${n.y}`} cx={n.x} cy={n.y} r="1.6" fill="currentColor" />
      ))}
    </>
  );
}

const GLYPH_BY_LEVEL: Record<number, () => React.JSX.Element> = {
  1: RaspberryCoreGlyph,
  2: GtxDualGlyph,
  3: RtxAiNodeGlyph,
  4: AppleMMaxGlyph,
  5: TensorV100Glyph,
  6: A100SubstationGlyph,
  7: H100SovereignGlyph,
  8: BlackwellB200Glyph,
  9: QuantumQubitGlyph,
  10: DysonSwarmGlyph,
};

const KNOWN_LEVELS = 10;

function glyphForLevel(level: number | null | undefined): () => React.JSX.Element {
  if (!level || level < 1) return RaspberryCoreGlyph;
  const known = GLYPH_BY_LEVEL[level];
  if (known) return known;
  // Рівень поза відомими 1..10 (майбутній контент понад поточний каталог) —
  // детерміновано циклюємо по вже наявних формах замість того, щоб завжди
  // падати на однакову заглушку.
  const cyclePosition = ((level - 1) % KNOWN_LEVELS) + 1;
  return GLYPH_BY_LEVEL[cyclePosition] ?? RaspberryCoreGlyph;
}

export interface MinerIconProps {
  /** gpu_templates.level (1..10) — обирає форму. */
  level?: number | null;
  /** gpu_templates.rarity — обирає колір світіння (та сама шкала, що й rarity-бейдж поруч). */
  rarity?: string | null;
  className?: string;
}

/**
 * Неонова векторна іконка майнера. Розмір/лейаут — через `className`
 * (напр. "h-8 w-8"), колір і glow резолвляться з `rarity` автоматично.
 */
export function MinerIcon({ level, rarity, className }: MinerIconProps) {
  const color = colorForRarity(rarity);
  const Glyph = glyphForLevel(level);

  return (
    <span className={className} style={{ color }}>
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-full w-full"
        aria-hidden="true"
      >
        <Glyph />
      </svg>
    </span>
  );
}

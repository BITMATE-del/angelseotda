// Generates traditional-style hwatu (화투) card face SVGs into public/cards/hwatu/
// 1월 ~ 10월, 2 cards each (a / b) = 20 sutda cards.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "public/cards/hwatu";
mkdirSync(OUT, { recursive: true });

const W = 240;
const H = 360;

const CREAM = "#f6efdf";
const CREAM2 = "#e9dcc0";
const INK = "#151312";
const RED = "#cf1f24";
const DEEP = "#8f1418";
const GOLD = "#c9a24a";
const GREEN = "#1f4f2f";
const YELLOW = "#e8b93a";
const WHITE = "#fbf8f1";

const rnd = (s) => {
  let x = s * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
};

function leafCluster(cx, cy, count, spread, size, color, seed) {
  const r = rnd(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const a = -90 + (i / (count - 1 || 1)) * 200 + (r() - 0.5) * 24;
    const rad = (a * Math.PI) / 180;
    const x = cx + Math.cos(rad) * spread * (0.5 + r() * 0.7);
    const y = cy + Math.sin(rad) * spread * (0.45 + r() * 0.7);
    const s = size * (0.65 + r() * 0.6);
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a + 90).toFixed(
      1,
    )})"><path d="M0 0 C ${s * 0.7} ${-s * 0.5}, ${s * 0.7} ${-s * 1.5}, 0 ${-s * 2.1} C ${
      -s * 0.7
    } ${-s * 1.5}, ${-s * 0.7} ${-s * 0.5}, 0 0 Z" fill="${color}"/></g>`;
  }
  return out;
}

function blossom(cx, cy, r, petal, center) {
  let out = "";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    out += `<ellipse cx="${(cx + Math.cos(a) * r * 0.62).toFixed(1)}" cy="${(
      cy +
      Math.sin(a) * r * 0.62
    ).toFixed(1)}" rx="${(r * 0.55).toFixed(1)}" ry="${(r * 0.62).toFixed(1)}" fill="${petal}" transform="rotate(${(
      (a * 180) / Math.PI +
      90
    ).toFixed(1)} ${(cx + Math.cos(a) * r * 0.62).toFixed(1)} ${(cy + Math.sin(a) * r * 0.62).toFixed(1)})"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.3).toFixed(1)}" fill="${center}"/>`;
  return out;
}

function branch(path, color, width) {
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function kwangBanner() {
  return `
  <g>
    <rect x="150" y="238" width="66" height="86" rx="6" fill="${DEEP}"/>
    <rect x="155" y="243" width="56" height="76" rx="4" fill="none" stroke="${YELLOW}" stroke-width="2"/>
    <text x="183" y="296" font-family="'Noto Serif KR',serif" font-size="46" font-weight="700" fill="${WHITE}" text-anchor="middle">광</text>
  </g>`;
}

function redRibbon(text = "") {
  return `<g>
    <rect x="40" y="120" width="160" height="42" rx="6" fill="${RED}"/>
    <rect x="46" y="126" width="148" height="30" rx="4" fill="none" stroke="${WHITE}" stroke-opacity="0.5"/>
    ${text ? `<text x="120" y="152" font-family="'Noto Serif KR',serif" font-size="24" fill="${WHITE}" text-anchor="middle">${text}</text>` : ""}
  </g>`;
}

const crane = `
<g transform="translate(120 210)">
  <path d="M-52 40 C -30 -6, 26 -22, 54 6 C 30 34, -10 52, -52 40 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2"/>
  <path d="M6 -8 C 22 -34, 44 -44, 58 -34 C 44 -14, 24 -4, 6 -8 Z" fill="${INK}"/>
  <path d="M-30 6 C -16 -12, 6 -18, 20 -10 C 4 4, -14 12, -30 6 Z" fill="${INK}" opacity="0.85"/>
  <path d="M-40 34 C -58 20, -66 -6, -54 -26" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="-56" cy="-30" r="8" fill="${WHITE}" stroke="${INK}" stroke-width="2"/>
  <circle cx="-58" cy="-32" r="2.4" fill="${INK}"/>
  <path d="M-64 -28 L -80 -24" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
  <path d="M-54 -38 q 6 -8 12 -4" stroke="${RED}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M-6 44 L -10 62 M14 44 L 18 62" stroke="${INK}" stroke-width="3"/>
</g>`;

const bird = `
<g transform="translate(122 208)">
  <path d="M-40 22 C -20 -12, 24 -22, 46 -2 C 26 26, -14 40, -40 22 Z" fill="${INK}"/>
  <path d="M-4 -6 C 10 -30, 34 -34, 44 -22 C 30 -8, 10 -2, -4 -6 Z" fill="${DEEP}"/>
  <circle cx="-34" cy="10" r="12" fill="${INK}"/>
  <circle cx="-38" cy="7" r="2.6" fill="${CREAM}"/>
  <path d="M-46 12 L -62 16" stroke="${YELLOW}" stroke-width="5" stroke-linecap="round"/>
  <path d="M6 30 C 26 40, 40 52, 44 66" fill="none" stroke="${INK}" stroke-width="5"/>
</g>`;

const boar = `
<g transform="translate(120 220)">
  <path d="M-56 24 C -46 -14, 6 -34, 42 -16 C 60 -4, 52 32, 18 38 C -14 44, -46 42, -56 24 Z" fill="#2b2320"/>
  <path d="M34 -18 C 54 -22, 66 -8, 60 6 C 52 18, 36 16, 30 6 Z" fill="#171311"/>
  <circle cx="44" cy="-6" r="2.6" fill="${CREAM}"/>
  <path d="M62 4 q 12 2 14 -8" stroke="${WHITE}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M-30 38 l -4 18 M2 40 l -2 18 M28 34 l 4 18" stroke="#171311" stroke-width="7" stroke-linecap="round"/>
</g>`;

const deer = `
<g transform="translate(120 214)">
  <path d="M-46 34 C -40 -2, -6 -20, 24 -12 C 46 -6, 48 28, 20 38 C -8 46, -40 50, -46 34 Z" fill="#8a5a2b"/>
  <path d="M22 -12 C 40 -26, 60 -20, 58 -2 C 56 12, 38 14, 28 4 Z" fill="#a06c33"/>
  <circle cx="48" cy="-10" r="2.6" fill="${INK}"/>
  <path d="M40 -26 l 6 -22 m0 0 l -10 6 m10 -6 l 10 4 M56 -22 l 10 -20 m0 0 l -10 4 m10 -4 l 8 6" stroke="#5d3a18" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M-26 40 l -4 18 M6 42 l -2 18 M28 36 l 4 20" stroke="#7b4f26" stroke-width="6" stroke-linecap="round"/>
</g>`;

const moon = `
<g>
  <circle cx="120" cy="150" r="54" fill="${RED}"/>
  <circle cx="120" cy="150" r="54" fill="none" stroke="${DEEP}" stroke-width="3"/>
</g>`;

const sun = `
<g>
  <circle cx="150" cy="120" r="46" fill="${RED}"/>
</g>`;

const geese = `
<g fill="${INK}">
  <path d="M60 250 q 16 -16 32 0 q -16 -8 -32 0 Z"/>
  <path d="M104 276 q 16 -16 32 0 q -16 -8 -32 0 Z"/>
  <path d="M148 252 q 16 -16 32 0 q -16 -8 -32 0 Z"/>
</g>`;

const butterfly = `
<g transform="translate(122 214)">
  <path d="M0 0 C -34 -34, -62 -18, -46 8 C -34 28, -10 20, 0 6 Z" fill="${INK}"/>
  <path d="M0 0 C 34 -34, 62 -18, 46 8 C 34 28, 10 20, 0 6 Z" fill="${INK}"/>
  <path d="M-40 -12 q 10 8 22 6 M40 -12 q -10 8 -22 6" stroke="${YELLOW}" stroke-width="4" fill="none"/>
  <rect x="-4" y="-6" width="8" height="34" rx="4" fill="#2b2320"/>
  <path d="M-2 -8 q -12 -16 -20 -20 M2 -8 q 12 -16 20 -20" stroke="#2b2320" stroke-width="3" fill="none"/>
</g>`;

const grass = (color = INK) => `
<g stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round">
  <path d="M56 330 C 66 268, 84 236, 104 214"/>
  <path d="M96 332 C 104 274, 116 246, 130 222"/>
  <path d="M140 332 C 142 272, 152 244, 170 218"/>
  <path d="M182 330 C 180 280, 188 254, 200 232"/>
</g>`;

function frame(inner, opts = {}) {
  const accent = opts.accent ?? INK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${CREAM}"/>
      <stop offset="1" stop-color="${CREAM2}"/>
    </linearGradient>
    <clipPath id="clip"><rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16"/></clipPath>
  </defs>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="20" fill="${INK}"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="url(#paper)"/>
  <g clip-path="url(#clip)">${inner}</g>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="none" stroke="${accent}" stroke-width="4"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="10" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="1.5"/>
</svg>`;
}

const months = {
  1: {
    // 소나무 / 학
    a: () =>
      frame(
        `${sun}${branch("M20 340 C 60 300, 70 240, 60 170 C 54 120, 70 80, 96 56", "#3d2a17", 12)}
        ${leafCluster(70, 150, 9, 44, 15, GREEN, 11)}${leafCluster(150, 300, 8, 40, 14, GREEN, 12)}${crane}${kwangBanner()}`,
      ),
    b: () =>
      frame(
        `${branch("M30 340 C 70 296, 66 236, 54 168 C 46 120, 66 78, 92 52", "#3d2a17", 12)}
        ${leafCluster(64, 140, 10, 48, 16, GREEN, 21)}${leafCluster(160, 250, 10, 50, 16, GREEN, 22)}
        ${leafCluster(120, 330, 8, 44, 14, GREEN, 23)}`,
      ),
  },
  2: {
    // 매화 / 새
    a: () =>
      frame(
        `${branch("M24 336 C 76 290, 96 226, 92 150 C 90 108, 120 70, 158 54", "#40281c", 10)}
        ${blossom(74, 118, 26, WHITE, YELLOW)}${blossom(160, 92, 22, RED, YELLOW)}${blossom(186, 172, 20, WHITE, YELLOW)}
        ${bird}`,
      ),
    b: () =>
      frame(
        `${branch("M28 338 C 82 292, 100 228, 96 150 C 94 106, 130 66, 170 50", "#40281c", 10)}
        ${blossom(70, 126, 28, RED, YELLOW)}${blossom(152, 96, 24, WHITE, YELLOW)}
        ${blossom(190, 190, 22, RED, YELLOW)}${blossom(110, 250, 26, WHITE, YELLOW)}${blossom(176, 296, 20, RED, YELLOW)}`,
    ),
  },
  3: {
    // 벚꽃 / 광
    a: () =>
      frame(
        `${branch("M20 330 C 70 300, 90 250, 96 190 C 100 140, 130 100, 168 76", "#4a3020", 10)}
        ${blossom(78, 140, 26, "#f6c9d4", RED)}${blossom(150, 104, 24, "#f6c9d4", RED)}
        ${blossom(60, 214, 22, WHITE, RED)}${blossom(180, 176, 20, "#f6c9d4", RED)}
        ${redRibbon("만막")}${kwangBanner()}`,
      ),
    b: () =>
      frame(
        `${branch("M24 334 C 74 302, 94 252, 100 192 C 104 142, 132 100, 172 78", "#4a3020", 10)}
        ${blossom(72, 150, 28, "#f6c9d4", RED)}${blossom(154, 112, 26, WHITE, RED)}
        ${blossom(62, 232, 24, "#f6c9d4", RED)}${blossom(178, 200, 22, WHITE, RED)}
        ${blossom(120, 292, 26, "#f6c9d4", RED)}`,
      ),
  },
  4: {
    // 흑싸리 / 새
    a: () =>
      frame(
        `${branch("M120 344 C 118 280, 116 210, 118 140", INK, 9)}
        ${leafCluster(118, 250, 11, 54, 17, "#241d1a", 41)}${leafCluster(118, 160, 9, 46, 15, "#241d1a", 42)}
        ${bird}`,
      ),
    b: () =>
      frame(
        `${branch("M120 344 C 118 280, 116 210, 118 130", INK, 9)}
        ${leafCluster(118, 268, 12, 56, 18, "#241d1a", 43)}${leafCluster(118, 176, 11, 50, 16, "#241d1a", 44)}
        ${leafCluster(118, 104, 7, 40, 13, "#241d1a", 45)}`,
      ),
  },
  5: {
    // 난초
    a: () =>
      frame(
        `${grass(GREEN)}${blossom(120, 190, 28, RED, YELLOW)}${blossom(74, 232, 20, RED, YELLOW)}
        ${blossom(168, 226, 20, RED, YELLOW)}${redRibbon()}`,
      ),
    b: () =>
      frame(
        `${grass(GREEN)}${blossom(120, 200, 30, "#f2e2b6", GREEN)}${blossom(72, 246, 22, "#f2e2b6", GREEN)}
        ${blossom(170, 238, 22, "#f2e2b6", GREEN)}${blossom(120, 122, 20, "#f2e2b6", GREEN)}`,
      ),
  },
  6: {
    // 모란 / 나비
    a: () =>
      frame(
        `${leafCluster(120, 320, 10, 52, 18, "#1b3a24", 61)}
        ${blossom(120, 150, 46, RED, YELLOW)}${blossom(66, 220, 26, RED, YELLOW)}${blossom(178, 214, 26, RED, YELLOW)}
        ${butterfly}`,
      ),
    b: () =>
      frame(
        `${leafCluster(120, 322, 11, 54, 19, "#1b3a24", 62)}
        ${blossom(120, 158, 50, RED, YELLOW)}${blossom(60, 232, 28, RED, YELLOW)}${blossom(182, 226, 28, RED, YELLOW)}
        ${blossom(120, 74, 24, RED, YELLOW)}`,
      ),
  },
  7: {
    // 홍싸리 / 멧돼지
    a: () =>
      frame(
        `${branch("M120 340 C 118 280, 116 214, 118 150", "#5c2020", 9)}
        ${leafCluster(118, 250, 11, 52, 17, "#7d2a2a", 71)}${leafCluster(118, 160, 9, 44, 15, "#7d2a2a", 72)}
        ${boar}`,
      ),
    b: () =>
      frame(
        `${branch("M120 342 C 118 282, 116 212, 118 132", "#5c2020", 9)}
        ${leafCluster(118, 266, 12, 56, 18, "#7d2a2a", 73)}${leafCluster(118, 176, 11, 50, 16, "#7d2a2a", 74)}
        ${leafCluster(118, 104, 7, 40, 13, "#7d2a2a", 75)}`,
      ),
  },
  8: {
    // 달 / 억새 / 기러기
    a: () =>
      frame(
        `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="#1d1c22" opacity="0.06"/>
        ${moon}${grass("#6d5b3a")}${geese}${kwangBanner()}`,
      ),
    b: () =>
      frame(
        `${grass("#6d5b3a")}
        <g stroke="#8a7448" stroke-width="5" fill="none" stroke-linecap="round">
          <path d="M40 320 C 52 262, 68 232, 90 208"/><path d="M196 322 C 190 268, 180 240, 164 216"/>
        </g>
        ${geese}`,
      ),
  },
  9: {
    // 국화
    a: () =>
      frame(
        `${leafCluster(120, 316, 10, 52, 18, "#1f4030", 91)}
        ${blossom(120, 158, 44, YELLOW, DEEP)}${blossom(66, 226, 24, YELLOW, DEEP)}${blossom(178, 220, 24, YELLOW, DEEP)}
        ${redRibbon()}`,
      ),
    b: () =>
      frame(
        `${leafCluster(120, 318, 11, 54, 19, "#1f4030", 92)}
        ${blossom(120, 166, 46, YELLOW, DEEP)}${blossom(62, 240, 26, YELLOW, DEEP)}${blossom(182, 232, 26, YELLOW, DEEP)}
        ${blossom(120, 82, 24, YELLOW, DEEP)}`,
      ),
  },
  10: {
    // 단풍 / 사슴
    a: () =>
      frame(
        `${branch("M22 336 C 70 300, 88 250, 96 190", "#5b3a1e", 9)}
        ${leafCluster(80, 150, 10, 48, 17, "#b0431f", 101)}${leafCluster(178, 120, 8, 40, 15, "#b0431f", 102)}
        ${deer}`,
      ),
    b: () =>
      frame(
        `${branch("M24 338 C 72 302, 90 252, 98 188", "#5b3a1e", 9)}
        ${leafCluster(76, 158, 11, 50, 18, "#b0431f", 103)}${leafCluster(174, 128, 10, 44, 16, "#b0431f", 104)}
        ${leafCluster(120, 282, 10, 48, 17, "#b0431f", 105)}`,
      ),
  },
};

for (const [m, variants] of Object.entries(months)) {
  const mm = String(m).padStart(2, "0");
  writeFileSync(`${OUT}/${mm}-a.svg`, variants.a().trim());
  writeFileSync(`${OUT}/${mm}-b.svg`, variants.b().trim());
}

// card backs (skins)
const backs = {
  "back-classic-red": ["#7d0f14", "#3a0709", "#e0be6a"],
  "back-midnight-blue": ["#132a52", "#07101f", "#7fa8dd"],
  "back-emerald-green": ["#0f3f2c", "#061a12", "#66c99a"],
  "back-royal-purple": ["#3c1655", "#170822", "#c193e8"],
};
for (const [name, [c1, c2, accent]] of Object.entries(backs)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <pattern id="p" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M15 2 L28 15 L15 28 L2 15 Z" fill="none" stroke="${accent}" stroke-opacity="0.35"/>
      <circle cx="15" cy="15" r="3" fill="${accent}" fill-opacity="0.3"/>
    </pattern>
  </defs>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="20" fill="#0b0a09"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="url(#g)"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="url(#p)"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="10" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="0.7"/>
  <g transform="translate(120 180)">
    <circle r="46" fill="none" stroke="${accent}" stroke-width="3" stroke-opacity="0.8"/>
    <path d="M-34 6 C -20 -22, 20 -22, 34 6 C 16 -4, -16 -4, -34 6 Z" fill="${accent}" fill-opacity="0.9"/>
    <ellipse cy="-24" rx="16" ry="6" fill="none" stroke="${accent}" stroke-width="3"/>
  </g>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="none" stroke="${accent}" stroke-width="3"/>
</svg>`;
  writeFileSync(`${OUT}/${name}.svg`, svg);
}

console.log("generated hwatu cards + backs");

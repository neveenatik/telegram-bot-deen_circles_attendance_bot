// Embedded web fonts for rendered images.
//
// Vercel's Chromium ships only Open Sans (Latin/Greek/Cyrillic) with NO Arabic
// glyphs, so we must embed our own Arabic font. We inline the Cairo subsets as
// base64 @font-face rules under a single family ('Cairo'); the browser's real
// layout engine picks the right subset per glyph via unicode-range (Google
// Fonts uses the exact same technique). Latin digits/letters come from the
// Latin subset, Arabic letters from the Arabic subset — no tofu, no Satori
// same-family fallback hacks.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_FAMILY = 'Cairo';

const FONT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fonts',
);

// Standard Google Fonts unicode-ranges for the Cairo subsets.
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const ARABIC_RANGE =
  'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF,U+102E0-102FB,U+10E60-10E7E,U+10EFD-10EFF,U+1EC71-1ECB4,U+1ED01-1ED3D,U+1EE00-1EEBB';

function fontFace(weight: number, file: string, unicodeRange: string): string {
  const base64 = readFileSync(join(FONT_DIR, file)).toString('base64');
  return [
    '@font-face{',
    `font-family:'${FONT_FAMILY}';`,
    'font-style:normal;',
    `font-weight:${weight};`,
    'font-display:block;',
    `src:url(data:font/ttf;base64,${base64}) format('truetype');`,
    `unicode-range:${unicodeRange};`,
    '}',
  ].join('');
}

let cached: string | null = null;

// CSS @font-face block embedding Cairo (Arabic + Latin, weights 400/700).
export function fontFaceCss(): string {
  if (cached !== null) return cached;
  cached = [
    fontFace(400, 'cairo-arabic-400-normal.ttf', ARABIC_RANGE),
    fontFace(700, 'cairo-arabic-700-normal.ttf', ARABIC_RANGE),
    fontFace(400, 'cairo-latin-400-normal.ttf', LATIN_RANGE),
    fontFace(700, 'cairo-latin-700-normal.ttf', LATIN_RANGE),
  ].join('');
  return cached;
}

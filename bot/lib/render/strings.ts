// Text helpers for rendered images.

// The embedded Cairo font has no emoji glyphs, so an emoji would render as tofu
// (□). Shared images use clean typography instead: we strip emoji (and their
// variation selectors / ZWJ) from caller-supplied strings and collapse the
// leftover whitespace. The original emoji-rich strings still show fine in the
// Telegram messages themselves.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

export function stripEmoji(s: string): string {
  return s.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
}

// Escape a string for safe interpolation into HTML text/attribute contexts.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Prepare caller text for embedding in a rendered image: strip emoji, then
// HTML-escape so names/labels can't break or inject into the markup.
export function renderText(s: string): string {
  return escapeHtml(stripEmoji(s));
}

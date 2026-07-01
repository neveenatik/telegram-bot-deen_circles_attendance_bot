// Helper functions for page parsing and formatting

export function parsePageInput(input) {
  const trimmed = input.trim();

  // Single number: 5
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num < 1 || num > 604) return null;
    return num;
  }

  // Range: 3-5
  if (/^\d+-\d+$/.test(trimmed)) {
    const [start, end] = trimmed.split('-').map(s => parseInt(s, 10));
    if (start < 1 || end > 604 || start > end) return null;
    return `${start}-${end}`;
  }

  // List: 2,4,6
  if (/^(\d+,)*\d+$/.test(trimmed)) {
    const nums = trimmed.split(',').map(s => parseInt(s.trim(), 10));
    if (nums.some(n => n < 1 || n > 604)) return null;
    return nums.join(',');
  }

  return null;
}

export function formatPages(pageValue) {
  if (!pageValue) return '';
  const str = String(pageValue);
  const formatted = str.replace(/,/g, '،');
  return `ص${formatted}`;
}

export function getFirstPage(pageValue) {
  if (!pageValue) return 0;
  const str = String(pageValue);
  const match = str.match(/^\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export function sortArabic(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b, 'ar'));
}

export function groupIdFromCtx(ctx) {
  return String(ctx.chat.id);
}

export function getDisplayName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'بدون اسم';
}

/**
 * Split a raw command argument string into individual entries.
 * Entries can be separated by newline or comma.
 * Extend the regex here if new separators are needed in the future.
 */
export function splitEntries(rawInput) {
  return rawInput.split(/[\n,]/).map(e => e.trim()).filter(Boolean);
}

/**
 * Send a message that auto-deletes after `delay` ms.
 * Used for simple notifications/errors that should not clutter the group.
 * Falls back silently if the bot lacks delete permissions.
 */
export async function replyEphemeral(ctx, text, opts = {}, delay = 8000) {
  const sent = await ctx.reply(text, opts);
  setTimeout(async () => {
    try { await ctx.deleteMessage(sent.message_id); } catch (_) {}
  }, delay);
}

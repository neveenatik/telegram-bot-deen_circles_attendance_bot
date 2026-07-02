// Helper functions for page parsing and formatting
import { Markup } from 'telegraf';

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

export function pendingActionLabel(action) {
  if (action === 'add') return 'إضافة عضوة جديدة';
  if (action === 'rename') return 'تعديل اسم عضوة';
  if (action === 'addGuest') return 'إضافة ضيفة';
  if (action === 'editPage') return 'تعديل صفحة';
  return 'إدخال بيانات';
}

export function pendingCancelKb(uid) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء العملية المعلّقة', `aw:cancel:${uid}`)],
    [Markup.button.callback('✕ إغلاق', 'msg:dismiss')],
  ]);
}

export async function replyChunked(ctx, text, opts = {}, maxLen = 3500) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const lines = raw.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  let firstMessage = null;
  for (let i = 0; i < chunks.length; i += 1) {
    const extra = i === 0 ? { ...(opts || {}) } : { parse_mode: opts?.parse_mode };
    const sent = await ctx.reply(chunks[i], extra);
    if (!firstMessage) firstMessage = sent;
  }

  return firstMessage;
}

export async function ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting) {
  const pending = await getAwaiting(groupId, uid);
  if (!pending) return true;

  await ctx.answerCbQuery('لديك عملية إدخال معلّقة');
  await ctx.replyWithMarkdown(
    `⏳ لديك عملية معلّقة: *${pendingActionLabel(pending.action)}*\n\nأكملي الرد على الرسالة السابقة أو ألغِي العملية أولاً.`,
    pendingCancelKb(uid)
  );
  return false;
}

function withDismissKeyboard(opts = {}) {
  const closeRow = [Markup.button.callback('✕ إغلاق', 'msg:dismiss')];
  const replyMarkup = opts.reply_markup;

  if (!replyMarkup) {
    return { ...opts, ...Markup.inlineKeyboard([closeRow]) };
  }

  const inline = Array.isArray(replyMarkup.inline_keyboard) ? replyMarkup.inline_keyboard : null;
  if (!inline) return opts;

  const hasDismiss = inline.some((row) =>
    Array.isArray(row) && row.some((btn) => btn?.callback_data === 'msg:dismiss')
  );
  if (hasDismiss) return opts;

  return {
    ...opts,
    reply_markup: {
      ...replyMarkup,
      inline_keyboard: [...inline, closeRow],
    },
  };
}

/**
 * Send a message that auto-deletes after `delay` ms.
 * Used for simple notifications/errors that should not clutter the group.
 * Falls back silently if the bot lacks delete permissions.
 */
export async function replyEphemeral(ctx, text, opts = {}, delay = 8000) {
  const sent = await ctx.reply(text, withDismissKeyboard(opts));

  // In serverless runtimes (e.g., Vercel), delayed timers are unreliable
  // after the request lifecycle ends. Keep dismiss-only behavior there.
  if (process.env.VERCEL) return sent;

  const chatId = ctx.chat?.id ?? sent?.chat?.id;
  setTimeout(async () => {
    if (!chatId || !sent?.message_id) return;
    try {
      await ctx.telegram.deleteMessage(chatId, sent.message_id);
    } catch (err) {
      const description = err?.response?.description || err?.description || '';
      const ignorable = /message to delete not found|message can't be deleted|not enough rights|MESSAGE_ID_INVALID/i.test(description);
      if (!ignorable) {
        console.warn('replyEphemeral delete failed:', description || err?.message || err);
      }
    }
  }, delay);
  return sent;
}

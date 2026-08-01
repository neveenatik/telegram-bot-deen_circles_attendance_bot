// Helper functions for page parsing and formatting
import { Markup } from 'telegraf';

export function getErrorDescription(err) {
  return err?.response?.description || err?.description || err?.message || String(err || 'unknown error');
}

export function isIgnorableTelegramError(err) {
  const description = getErrorDescription(err);
  return /message is not modified|message to delete not found|message can't be deleted|not enough rights|MESSAGE_ID_INVALID|chat not found|message to edit not found/i.test(description);
}

export function logTelegramError(scope, err, context = {}, options = {}) {
  const description = getErrorDescription(err);
  const ignorable = options.ignoreKnown !== false && isIgnorableTelegramError(err);
  if (ignorable) return;

  console.warn(JSON.stringify({
    level: 'warn',
    event: 'telegram_api_error',
    scope,
    message: description,
    context,
    at: new Date().toISOString(),
  }));
}

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

export function escapeTelegramMarkdown(text) {
  const raw = String(text ?? '');
  // Telegram Markdown (legacy) is sensitive to these chars in user-provided text.
  return raw.replace(/([_\*\[\]`])/g, '\\$1');
}

/**
 * Split a raw command argument string into individual entries.
 * Entries can be separated by newline or comma.
 * Extend the regex here if new separators are needed in the future.
 */
export function splitEntries(rawInput) {
  return rawInput.split(/[\n,]/).map(e => e.trim()).filter(Boolean);
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

/**
 * Start a force-reply "awaiting" flow (Option A) that works whether the prompt
 * is shown in the group or privately in an admin's DM.
 *
 * The prompt is sent first, then a reply-prompt record is stored keyed by the
 * prompt message's own id (chat + message_id). When the admin replies, Telegram
 * echoes `reply_to_message.message_id`, which actions/text.js looks up directly.
 * Because every open prompt has its own record, an admin can have several
 * prompts pending at once with no blocking and no "lingering pending step" nag.
 *
 * The real target `groupId` is carried inside the record so edits land on the
 * correct group even when the reply arrives in a private chat. For in-group
 * panels the prompt chat *is* the group, so this is behaviour-preserving.
 *
 * @returns the sent prompt message.
 */
export async function beginForceReplyAwaiting(ctx, { setReplyPrompt, groupId, record, sendPrompt }) {
  await ctx.answerCbQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  const prompt = await sendPrompt();
  await setReplyPrompt(String(ctx.chat.id), prompt.message_id, {
    ...record,
    userId: String(ctx.from.id),
    groupId: String(groupId),
    chatId: ctx.chat.id,
    msgId,
  });
  return prompt;
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
      logTelegramError('replyEphemeral.deleteMessage', err, {
        chatId: String(chatId),
        messageId: sent?.message_id || null,
      });
    }
  }, delay);
  return sent;
}

// Group-side "pending join requests" nudge.
//
// The full pending-registrations panel is delivered privately (DM) because it
// prints each requester's Telegram id/username. To surface pending requests
// during a live session without leaking that data into the group, we post a
// single lightweight, data-free ping in the group with one button that opens
// the private panel. The ping is reused/updated as the queue grows or shrinks
// and is removed once the queue is empty. It only exists while a session is
// active — the message id lives on the active session so it is persisted and
// cleaned up with the session lifecycle.

import { Markup } from 'telegraf';
import { TEXT } from './text.js';
import { logTelegramError } from './helpers.js';

const nudgeKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback(TEXT.pendingNudgeButton, 'pr:opendm')]]);

/**
 * Post, update, or remove the group nudge to reflect the current pending count.
 *
 * @param {object}   args
 * @param {object}   args.telegram  bot.telegram client
 * @param {object}   args.storage   storage facade (getActiveSession, getPendingRegistrations, saveSession)
 * @param {string|number} args.groupId
 * @param {object}   [args.session] active session object (avoids a re-read when the caller already has it)
 * @param {string}   [args.type]    active session type (paired with session)
 */
export async function syncPendingNudge({ telegram, storage, groupId, session, type }) {
  if (!telegram || !storage) return;
  const { getActiveSession, getPendingRegistrations, saveSession } = storage;

  let s = session || null;
  let t = type || null;
  if (!s || !t) {
    const active = getActiveSession ? await getActiveSession(groupId) : null;
    s = active?.session || null;
    t = active?.type || null;
  }
  // Only nudge while a session is active.
  if (!s || !t) return;

  const pending = getPendingRegistrations ? await getPendingRegistrations(groupId) : [];
  const count = Array.isArray(pending) ? pending.length : 0;
  const existingId = s.pendingNudgeMessageId || null;
  const kb = nudgeKeyboard();

  if (count > 0) {
    if (existingId) {
      try {
        await telegram.editMessageText(groupId, existingId, undefined, TEXT.pendingNudgeGroup(count), {
          parse_mode: 'Markdown',
          ...kb,
        });
        return;
      } catch (err) {
        // The message may have been deleted in the group — fall through and re-post.
        logTelegramError('pendingNudge.edit', err, { chatId: String(groupId) });
      }
    }
    try {
      const sent = await telegram.sendMessage(groupId, TEXT.pendingNudgeGroup(count), {
        parse_mode: 'Markdown',
        ...kb,
      });
      s.pendingNudgeMessageId = sent?.message_id ?? null;
      if (saveSession) await saveSession(groupId, t, s);
    } catch (err) {
      logTelegramError('pendingNudge.send', err, { chatId: String(groupId) });
    }
    return;
  }

  // No pending requests left — remove the nudge if we posted one.
  if (existingId) {
    try {
      await telegram.deleteMessage(groupId, existingId);
    } catch (err) {
      logTelegramError('pendingNudge.delete', err, { chatId: String(groupId) });
    }
    s.pendingNudgeMessageId = null;
    if (saveSession) await saveSession(groupId, t, s);
  }
}

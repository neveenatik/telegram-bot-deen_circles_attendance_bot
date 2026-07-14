/**
 * Shared test doubles for handler unit tests.
 *
 * These build plain mock objects (no Telegraf / no DB) so handler logic can be
 * exercised in isolation.
 */

// replyEphemeral schedules a setTimeout(deleteMessage, 8000) unless VERCEL is set.
// In tests we never want that timer (it keeps the event loop alive and fires
// against mock objects), so behave like the serverless path.
process.env.VERCEL = process.env.VERCEL || '1';

/**
 * Build a mock Telegram client (the object normally reached via `bot.telegram`).
 * Every method records its args on `telegram.calls[method]` and resolves to a
 * plausible value so handler code can `await` it.
 */
export function makeTelegram(overrides = {}) {
  const calls = {
    sendMessage: [],
    editMessageText: [],
    editMessageReplyMarkup: [],
    deleteMessage: [],
    pinChatMessage: [],
    unpinChatMessage: [],
    answerCbQuery: [],
    getChatMember: [],
  };
  const telegram = {
    calls,
    sendMessage(...a) { calls.sendMessage.push(a); return Promise.resolve({ message_id: 900 }); },
    editMessageText(...a) { calls.editMessageText.push(a); return Promise.resolve(true); },
    editMessageReplyMarkup(...a) { calls.editMessageReplyMarkup.push(a); return Promise.resolve(true); },
    deleteMessage(...a) { calls.deleteMessage.push(a); return Promise.resolve(true); },
    pinChatMessage(...a) { calls.pinChatMessage.push(a); return Promise.resolve(true); },
    unpinChatMessage(...a) { calls.unpinChatMessage.push(a); return Promise.resolve(true); },
    answerCbQuery(...a) { calls.answerCbQuery.push(a); return Promise.resolve(true); },
    getChatMember(...a) { calls.getChatMember.push(a); return Promise.resolve({ status: 'administrator' }); },
    getMe() { return Promise.resolve({ id: 42, is_bot: true, username: 'DeenCirclesBot', first_name: 'Deen Circles' }); },
    ...overrides,
  };
  return telegram;
}

/**
 * Build a mock Telegraf context.
 *
 * Options:
 * - chatType: 'group' | 'supergroup' | 'private'  (private always => isAdmin false)
 * - admin / creator: convenience flags that set getChatMember status
 * - memberStatus: explicit getChatMember status ('member' | 'administrator' | 'creator' | 'left')
 * - text: value for ctx.message.text (command parsing)
 * - match: value for ctx.match (action regex groups)
 * - messageId: id of ctx.callbackQuery.message / ctx.message
 *
 * All outbound calls are recorded on `ctx.calls` (also returned separately).
 */
export function makeCtx({
  chatType = 'group',
  chatId = 123,
  userId = 999,
  match = ['a:present', 'present'],
  text,
  messageId = 555,
  admin = false,
  creator = false,
  memberStatus,
  from = { id: userId, first_name: 'Test', last_name: 'User', username: 'tester' },
} = {}) {
  const status = memberStatus || (creator ? 'creator' : admin ? 'administrator' : 'member');

  const calls = {
    answerCbQuery: [],
    editMessageReplyMarkup: [],
    editMessageText: [],
    reply: [],
    replyWithMarkdown: [],
    replyWithHTML: [],
    deleteMessage: [],
    pinChatMessage: [],
    unpinChatMessage: [],
    getChatMember: [],
  };

  const telegram = makeTelegram();

  const ctx = {
    chat: { id: chatId, type: chatType },
    from,
    message: text !== undefined ? { message_id: messageId, text } : { message_id: messageId },
    callbackQuery: { message: { message_id: messageId } },
    match,
    calls,
    telegram,
    answerCbQuery(...a) { calls.answerCbQuery.push(a); return Promise.resolve(true); },
    editMessageReplyMarkup(...a) { calls.editMessageReplyMarkup.push(a); return Promise.resolve(true); },
    editMessageText(...a) { calls.editMessageText.push(a); return Promise.resolve(true); },
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 556, chat: { id: chatId } }); },
    replyWithMarkdown(...a) { calls.replyWithMarkdown.push(a); return Promise.resolve({ message_id: 557, chat: { id: chatId } }); },
    replyWithHTML(...a) { calls.replyWithHTML.push(a); return Promise.resolve({ message_id: 558, chat: { id: chatId } }); },
    deleteMessage(...a) { calls.deleteMessage.push(a); return Promise.resolve(true); },
    pinChatMessage(...a) { calls.pinChatMessage.push(a); return Promise.resolve(true); },
    unpinChatMessage(...a) { calls.unpinChatMessage.push(a); return Promise.resolve(true); },
    getChatMember(...a) { calls.getChatMember.push(a); return Promise.resolve({ status }); },
  };
  return { ctx, calls, telegram };
}

/** Minimal storage stub; pass overrides to replace only the methods a test needs. */
export function makeStorage(overrides = {}) {
  return {
    getMaster: async () => ({ members: [] }),
    saveMaster: async () => {},
    getActiveSession: async () => null,
    saveSession: async () => {},
    saveParticipant: async () => {},
    removeParticipant: async () => {},
    allocateGroupRecitationPage: async () => 1,
    setGroupRecitationPageCounter: async () => {},
    getPageProgress: async () => ({}),
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async () => {},
    getHistory: async () => [],
    saveHistory: async () => {},
    getReplyPrompt: async () => null,
    setReplyPrompt: async () => {},
    delReplyPrompt: async () => {},
    getParentGroupId: async () => null,
    setParentGroup: async () => {},
    addMembers: async () => {},
    deleteSession: async () => ({ ok: true }),
    ...overrides,
  };
}

/** Build a master-list object with the given member entries. */
export function makeMaster(members = []) {
  return { members };
}

/** Build a minimal active-session wrapper as returned by getActiveSession. */
export function makeActiveSession({ type = 'registered', session = {} } = {}) {
  return {
    type,
    session: {
      name: 'الحلقة',
      type,
      active: true,
      participants: {},
      ...session,
    },
  };
}

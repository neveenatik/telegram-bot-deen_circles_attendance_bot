import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import { sessionText, sessionKb, refreshSessionWidget } from '../../widgets.js';

const DEFAULT_SESSION_NAMES = {
  main: 'مجلس اليوم',
  open: 'مجلس مفتوح',
  registeredSecondary: 'تصحيح التلاوة',
  personalRecitation: 'ختمة فردية',
  groupRecitation: 'ختمة جماعية',
};

export function register(bot, storage) {
  const { getMaster, getSession, saveSession, getCurrentSeries, getGroupRecitationNextPage } = storage;

  // Helper to check if any session is currently active
  async function hasActiveSession(groupId) {
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) return true;
    }
    return false;
  }

  async function startSession(ctx, type, initializeAttendance) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return replyEphemeral(ctx, TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || DEFAULT_SESSION_NAMES[type] || 'جلسة';

    const master = await getMaster(groupId);
    const seriesId = await getCurrentSeries(groupId);
    const attendance = initializeAttendance
      ? Object.fromEntries(master.members.map((m) => [m.name, null]))
      : {};

    const session = {
      type,
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId:    ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active:    true,
      registrationActive: true,
      allowPublicRegistration: type === 'open',
      attendance,
      registrationTimes: {},
      called: {},
      checkpoints: [],
      nextCheckpointId: 1,
    };

    if (type === 'registeredSecondary') {
      session.verses = {};
    }

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, session.allowPublicRegistration));
    session.messageId = sent.message_id;
    await saveSession(groupId, type, session);
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinMainWidget', err, {
        groupId,
        sessionType: type,
        messageId: sent.message_id,
      });
    }
  }

  bot.command('startlist',           (ctx) => startSession(ctx, 'main', true));
  bot.command('startopenlist',       (ctx) => startSession(ctx, 'open', false));
  bot.command('startsecondarylist',  (ctx) => startSession(ctx, 'registeredSecondary', true));

  bot.command('startpersonalrecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return replyEphemeral(ctx, TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || DEFAULT_SESSION_NAMES.personalRecitation;

    const master = await getMaster(groupId);
    const seriesId = await getCurrentSeries(groupId);
    const session = {
      type: 'personalRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId: ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      pages: {},
      attendance: {},
      registrationTimes: {},
      called: {},
      checkpoints: [],
      nextCheckpointId: 1,
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'personalRecitation', session);
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, 'personalRecitation', session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinPersonalRecitationWidget', err, {
        groupId,
        sessionType: 'personalRecitation',
        messageId: sent.message_id,
      });
    }
  });

  bot.command('startgrouprecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return replyEphemeral(ctx, TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || DEFAULT_SESSION_NAMES.groupRecitation;

    const master = await getMaster(groupId);
    const nextPage = await getGroupRecitationNextPage(groupId);
    const seriesId = await getCurrentSeries(groupId);

    const session = {
      type: 'groupRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId: ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      groupRecitation: true,
      groupRecitationStartPage: nextPage,
      pages: {},
      attendance: {},
      registrationTimes: {},
      called: {},
      checkpoints: [],
      nextCheckpointId: 1,
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'groupRecitation', session);
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, 'groupRecitation', session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinGroupRecitationWidget', err, {
        groupId,
        sessionType: 'groupRecitation',
        messageId: sent.message_id,
      });
    }
  });
}

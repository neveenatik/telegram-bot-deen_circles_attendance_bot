import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import { sessionText, sessionKb, refreshSessionWidget } from '../../widgets.js';

const DEFAULT_SESSION_NAMES = {
  main: 'مجلس اليوم',
  training: 'حلقة التدريب',
  open: 'مجلس مفتوح',
  registeredSecondary: 'تصحيح التلاوة',
  personalRecitation: 'ختمة فردية',
  groupRecitation: 'ختمة جماعية',
};

export function register(bot, storage) {
  const { getMaster, getSession, saveSession, getCurrentSeries, getGroupRecitationNextPage, getTrainingGroups } = storage;

  async function resendFirstActiveSessionWidget(groupId, requestedType, fallbackChatId = null) {
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (!session || !session.active) continue;

      const master = await getMaster(groupId);
      const chatId = session.chatId || fallbackChatId;
      if (!chatId) return false;

      const oldMainMessageId = session.messageId || null;
      const oldListMessageIds = Array.isArray(session.listMessageIds) ? [...session.listMessageIds] : [];

      const sent = await bot.telegram.sendMessage(
        chatId,
        sessionText(session, master),
        { parse_mode: 'Markdown', ...sessionKb(session.active, session.registrationActive !== false, session.allowPublicRegistration) }
      );

      session.chatId = chatId;
      session.messageId = sent.message_id;
      session.listMessageIds = [];
      await saveSession(groupId, type, session);

      await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));

      try {
        await bot.telegram.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
      } catch (err) {
        logTelegramError('start.pinResentMainWidget', err, {
          groupId,
          sessionType: type,
          messageId: sent.message_id,
        });
      }

      if (oldMainMessageId) {
        try {
          await bot.telegram.deleteMessage(chatId, oldMainMessageId);
        } catch (err) {
          logTelegramError('start.deleteOldMainWidget', err, {
            groupId,
            sessionType: type,
            messageId: oldMainMessageId,
          });
        }
      }

      for (const msgId of oldListMessageIds) {
        try {
          await bot.telegram.deleteMessage(chatId, msgId);
        } catch (err) {
          logTelegramError('start.deleteOldListWidget', err, {
            groupId,
            sessionType: type,
            messageId: msgId,
          });
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        event: 'start_resent_existing_session',
        groupId,
        requestedType,
        activeType: type,
        oldMainMessageId,
        oldListCount: oldListMessageIds.length,
        sessionMessageId: session.messageId || null,
        at: new Date().toISOString(),
      }));
      return true;
    }
    return false;
  }

  async function listActiveSessions(groupId) {
    const activeSessions = [];
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) {
        activeSessions.push({
          type,
          messageId: session.messageId || null,
          registrationActive: session.registrationActive,
          startedAt: session.startedAt || null,
        });
      }
    }
    return activeSessions;
  }

  // Helper to check if any session is currently active
  async function hasActiveSession(groupId) {
    const activeSessions = await listActiveSessions(groupId);
    return activeSessions.length > 0;
  }

  async function startSession(ctx, type, initializeAttendance, defaultName) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: type,
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, type, ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || defaultName || DEFAULT_SESSION_NAMES[type] || 'جلسة';

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
  bot.command('starttraininglist',   async (ctx) => {
    const groupId = groupIdFromCtx(ctx);
    const trainingGroups = await getTrainingGroups(groupId);
    if (trainingGroups && trainingGroups.length > 0) {
      return replyEphemeral(ctx, 'هذا الأمر متاح في مجموعات التدريب فقط');
    }
    return startSession(ctx, 'main', true, DEFAULT_SESSION_NAMES.training);
  });
  bot.command('startopenlist',       (ctx) => startSession(ctx, 'open', false));
  bot.command('startsecondarylist',  (ctx) => startSession(ctx, 'registeredSecondary', true));

  bot.command('startpersonalrecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: 'personalRecitation',
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, 'personalRecitation', ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

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
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: 'groupRecitation',
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, 'groupRecitation', ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

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

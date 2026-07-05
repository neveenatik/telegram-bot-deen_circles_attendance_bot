import { Markup } from 'telegraf';
import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, ensureNoPendingAwaiting, logTelegramError } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { TEXT, st } from '../../text.js';
import {
  calledState, rawSessionNames, manageText, manageKb, managePageOfIndex,
  refreshSessionWidget, refreshManageWidget,
} from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, getSession, saveSession, setAwaiting, getPageProgress, getAwaiting, delAwaiting } = storage;

  async function trackSessionBotMessage(groupId, activeType, session, messageId) {
    if (!session || !messageId) return;
    if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
    if (!session.actionMessageIds.includes(messageId)) {
      session.actionMessageIds.push(messageId);
      await saveSession(groupId, activeType, session);
    }
  }

  // Helper to find active session type
  async function getActiveSessionType(groupId) {
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) return type;
    }
    return null;
  }

  // Helper to recalculate pages based on registration order
  async function recalculatePagesFromRegistration(session, groupId) {
    if (!session.pageList && !session.groupRecitation) return;
    
    // Get all present members sorted by registration time, excluding those with away/excused call status
    const presentMembers = Object.entries(session.registrationTimes || {})
      .filter(([name]) => {
        if (session.attendance[name] !== 'present') return false;
        const callState = session.called?.[name];
        if (callState === 'away' || callState === 'excused') return false;
        return true;
      })
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);

    if (session.pageList) {
      const progress = await getPageProgress(groupId);
      session.pages = {};
      for (const name of presentMembers) {
        session.pages[name] = (Number(progress[name]) || 0) + 1;
      }
    }

    if (session.groupRecitation) {
      session.pages = {};
      session.groupRecitationStartPage = 1;
      for (const name of presentMembers) {
        session.pages[name] = session.groupRecitationStartPage;
        session.groupRecitationStartPage += 1;
      }
    }
  }

  // Helper to assign a page to a member (if applicable)
  async function assignPageIfNeeded(name, session, groupId) {
    if (!session.pageList && !session.groupRecitation) return;

    // Only assign if member has no page
    if (session.pages && session.pages[name] !== undefined && session.pages[name] !== null) return;

    // Check if call status is away or excused
    const callState = session.called?.[name];
    if (callState === 'away' || callState === 'excused') return;

    if (!session.pages) session.pages = {};

    if (session.pageList) {
      const progress = await getPageProgress(groupId);
      session.pages[name] = (Number(progress[name]) || 0) + 1;
    }

    if (session.groupRecitation) {
      // For group recitation, recalculate all pages based on registration order
      await recalculatePagesFromRegistration(session, groupId);
    }
  }

  // ─── sm:pick — open member actions menu ───────────────────────────────────────
  bot.action(/^sm:pick:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[1], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const { e } = st(session.attendance[name] || null);
    const callState = calledState(session, name);

    const buttons = [
      [
        Markup.button.callback(TEXT.manageButtons.present,   `sm:set:${i}:present`),
        Markup.button.callback(TEXT.manageButtons.listening, `sm:set:${i}:listening`),
      ],
      [
        Markup.button.callback(TEXT.manageButtons.excused, `sm:set:${i}:excused`),
        Markup.button.callback(TEXT.manageButtons.absent,  `sm:set:${i}:absent`),
      ],
      [
        Markup.button.callback(TEXT.manageButtons.markCalling,   `sm:call:${i}:responding`),
        Markup.button.callback(TEXT.manageButtons.markResponded, `sm:call:${i}:responded`),
      ],
      [Markup.button.callback(TEXT.manageButtons.markAway,    `sm:call:${i}:away`)],
      [Markup.button.callback(TEXT.manageButtons.clearCalled, `sm:call:${i}:clear`)],
    ];

    if (session.type === 'personalRecitation' || session.type === 'groupRecitation') {
      buttons.push([Markup.button.callback(TEXT.manageButtons.editPage, `sm:editpage:${i}`)]);
    } else if (session.type === 'registeredSecondary') {
      buttons.push([Markup.button.callback(TEXT.manageButtons.editVerse, `sm:editverse:${i}`)]);
    }
    buttons.push([Markup.button.callback(TEXT.manageButtons.back, `sm:back:${i}`)]);

    await ctx.editMessageText(
      TEXT.managePickHeader(name, e, callState),
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
    ctx.answerCbQuery();
  });

  // ─── sm:set — apply attendance status ─────────────────────────────────────────
  bot.action(/^sm:set:(\d+):(present|listening|excused|absent)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[1], 10);
    const name   = names[i];
    const status = ctx.match[2];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    session.attendance[name] = status;
    
    // If changed to present, assign page if needed
    if (status === 'present') {
      await assignPageIfNeeded(name, session, groupId);
    }
    // If changed away from present, delete page
    else if (session.pages?.[name]) {
      delete session.pages[name];
    }

    await saveSession(groupId, activeType, session);
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
    await refreshManageWidget(ctx, session, master, managePageOfIndex(i));
    ctx.answerCbQuery(TEXT.statusSet(name, st(status).a));
  });

  // ─── sm:call — mark/unmark called member ──────────────────────────────────────
  bot.action(/^sm:call:(\d+):(responding|responded|away|clear)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[1], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);
    const state = ctx.match[2];

    if (!session.called) session.called = {};
    session.called[name] = state === 'clear' ? null : state;
    await saveSession(groupId, activeType, session);
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
    await refreshManageWidget(ctx, session, master, managePageOfIndex(i));
    ctx.answerCbQuery(
      state === 'responding' ? `👉 ${name} الآن قيد الرد.`
        : state === 'responded' ? `✅ تم تعليم ${name} بأنها حاضرة.`
        : state === 'away'      ? `📣 تم تعليم ${name} بأنها كانت بعيدة عن الميكروفون.`
        : `↩️ أزيلت علامة النداء عن ${name}.`
    );
  });

  // ─── sm:editpage — prompt to edit a member's page ─────────────────────────────
  bot.action(/^sm:editpage:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[1], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editPage', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editPagePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الرقم', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editPage', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });

  // ─── sm:editverse — prompt to edit a member's verse (secondary session) ─────
  bot.action(/^sm:editverse:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);

    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    if (session.type !== 'registeredSecondary') return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names = rawSessionNames(session, master);
    const i = parseInt(ctx.match[1], 10);
    const name = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editVerse', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editVersePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'مثال: 12-18', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editVerse', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });

  // ─── sm:back / sm:page / sm:refresh / sm:hide / sm:addguest — navigation ──────
  bot.action(/^sm:back:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    const index = parseInt(ctx.match[1], 10);
    await refreshManageWidget(ctx, session, master, managePageOfIndex(index));
  });

  bot.action('sm:back', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    await refreshManageWidget(ctx, session, master);
  });

  bot.action(/^sm:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[1], 10);
    await refreshManageWidget(ctx, session, master, Number.isInteger(page) ? page : 0);
  });

  bot.action('sm:noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.action(/^sm:refresh:(\d+)$/, async (ctx) => {
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    const master = await getMaster(groupId);
    
    // Recalculate pages based on registration order (respects away/excused call status)
    await recalculatePagesFromRegistration(session, groupId);
    await saveSession(groupId, activeType, session);

    const page = parseInt(ctx.match[1], 10);
    await refreshManageWidget(ctx, session, master, Number.isInteger(page) ? page : 0);
    ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action('sm:refresh', async (ctx) => {
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    const master = await getMaster(groupId);

    await recalculatePagesFromRegistration(session, groupId);
    await saveSession(groupId, activeType, session);

    await refreshManageWidget(ctx, session, master, 0);
    ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action('sm:hide', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch { await ctx.editMessageText(TEXT.hiddenManageList); }
  });

  bot.action('msg:dismiss', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logTelegramError('manage.dismiss.deleteMessage', err, {
        chatId: String(ctx.chat?.id || ''),
      });
    }
  });

  bot.action(/^aw:cancel:(\d+)$/, async (ctx) => {
    const targetUid = ctx.match[1];
    const currentUid = String(ctx.from.id);
    if (targetUid !== currentUid)
      return ctx.answerCbQuery('هذه العملية ليست لك');

    const groupId = groupIdFromCtx(ctx);
    const pending = await getAwaiting(groupId, currentUid);
    if (!pending) {
      await ctx.answerCbQuery('لا توجد عملية معلّقة');
      try {
        await ctx.deleteMessage();
      } catch (err) {
        logTelegramError('manage.awaitCancel.deletePromptNoPending', err, {
          chatId: String(ctx.chat?.id || ''),
        });
      }
      return;
    }

    await delAwaiting(groupId, currentUid);
    if (pending.promptMsgId) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, pending.promptMsgId);
      } catch (err) {
        logTelegramError('manage.awaitCancel.deleteOriginalPrompt', err, {
          chatId: String(ctx.chat?.id || ''),
          messageId: pending.promptMsgId,
        });
      }
    }

    await ctx.answerCbQuery('✅ تم إلغاء العملية المعلّقة');
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logTelegramError('manage.awaitCancel.deleteCancelButton', err, {
        chatId: String(ctx.chat?.id || ''),
      });
    }
  });

  bot.action('sm:addguest', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'addGuest', chatId: ctx.chat.id, msgId, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.addGuestPrompt, {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'اسم الضيفة', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'addGuest', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });

  bot.action(/^sm:editname:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    const page = parseInt(ctx.match[1], 10);
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editSessionName', chatId: ctx.chat.id, msgId, promptMsgId: null,
      managePage: safePage, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editSessionNamePrompt(session.name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'اسم القائمة الجديد', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editSessionName', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id,
      managePage: safePage, awaitingPrompt: false,
    });
  });
}

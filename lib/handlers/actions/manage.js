import { Markup } from 'telegraf';
import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, ensureNoPendingAwaiting, logTelegramError } from '../../helpers.js';
import { getActiveSessionType, usesCallStatus } from '../../sessionTypes.js';
import { TEXT, st } from '../../text.js';
import {
  calledState, rawSessionNames, manageText, manageKb, managePageOfIndex,
  refreshSessionWidget as defaultRefreshSessionWidget,
  refreshManageWidget as defaultRefreshManageWidget,
} from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({
  storage,
  telegram,
  refreshSessionWidget = defaultRefreshSessionWidget,
  refreshManageWidget = defaultRefreshManageWidget,
}) {
  const { getMaster, getSession, saveSession, saveParticipant, setGroupRecitationPageCounter, setAwaiting, getPageProgress, getAwaiting, delAwaiting } = storage;

  async function trackSessionBotMessage(groupId, activeType, session, messageId) {
    if (!session || !messageId) return;
    if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
    if (!session.actionMessageIds.includes(messageId)) {
      session.actionMessageIds.push(messageId);
      await saveSession(groupId, activeType, session);
    }
  }

  async function resolveSessionType(groupId, requestedType = null) {
    if (requestedType) {
      const requested = await getSession(groupId, requestedType);
      if (requested?.active) return requestedType;
    }
    return getActiveSessionType(getSession, groupId);
  }

  // Helper to recalculate pages based on registration order
  async function recalculatePagesFromRegistration(session, groupId) {
    if (!session.pageList && !session.groupRecitation) return;
    
    // Get all present members sorted by registration time, excluding those with away/excused call status
    const presentMembers = participants.list(session)
      .filter((p) => p.registeredAt !== undefined)
      .filter((p) => p.status === 'present')
      .filter((p) => p.called !== 'away' && p.called !== 'excused')
      .map((p) => p.name);

    if (session.pageList) {
      const progress = await getPageProgress(groupId);
      participants.clearAllPages(session);
      for (const name of presentMembers) {
        participants.setPage(session, name, (Number(progress[name]) || 0) + 1);
      }
    }

    if (session.groupRecitation) {
      participants.clearAllPages(session);
      session.groupRecitationStartPage = 1;
      for (const name of presentMembers) {
        participants.setPage(session, name, session.groupRecitationStartPage);
        session.groupRecitationStartPage += 1;
      }
      // The allocator lives in its own column; the wholesale recompute above only
      // touched the in-memory copy, so persist the final value explicitly.
      await setGroupRecitationPageCounter(groupId, session.type, session.groupRecitationStartPage);
    }
  }

  // Helper to assign a page to a member (if applicable)
  async function assignPageIfNeeded(name, session, groupId) {
    if (!session.pageList && !session.groupRecitation) return;

    // Only assign if member has no page
    if (participants.getPage(session, name) != null) return;

    // Check if call status is away or excused
    const callState = participants.getCalled(session, name);
    if (callState === 'away' || callState === 'excused') return;

    if (session.pageList) {
      const progress = await getPageProgress(groupId);
      participants.setPage(session, name, (Number(progress[name]) || 0) + 1);
    }

    if (session.groupRecitation) {
      // For group recitation, recalculate all pages based on registration order
      await recalculatePagesFromRegistration(session, groupId);
    }
  }

  async function choose(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const sessionType = await resolveSessionType(groupId, ctx.match[1]);
    if (!sessionType) return ctx.answerCbQuery(TEXT.noSessionShort);

    const session = await getSession(groupId, sessionType);
    if (!session?.active) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    await ctx.editMessageText(manageText(session, master), {
      parse_mode: 'Markdown',
      ...manageKb(session, master, 0, sessionType),
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  // ─── sm:pick — open member actions menu ───────────────────────────────────────
  async function pick(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[2], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const { e } = st(participants.getStatus(session, name));
    const callState = calledState(session, name);
    const showCall = usesCallStatus(session.type);

    const buttons = [
      [
        Markup.button.callback(TEXT.manageButtons.present,   `sm:${activeType}:set:${i}:present`),
        Markup.button.callback(TEXT.manageButtons.listening, `sm:${activeType}:set:${i}:listening`),
      ],
      [
        Markup.button.callback(TEXT.manageButtons.excused, `sm:${activeType}:set:${i}:excused`),
        Markup.button.callback(TEXT.manageButtons.absent,  `sm:${activeType}:set:${i}:absent`),
      ],
      ...(showCall ? [
        [
          Markup.button.callback(TEXT.manageButtons.markCalling,   `sm:${activeType}:call:${i}:responding`),
          Markup.button.callback(TEXT.manageButtons.markResponded, `sm:${activeType}:call:${i}:responded`),
        ],
        [Markup.button.callback(TEXT.manageButtons.markAway,    `sm:${activeType}:call:${i}:away`)],
        [Markup.button.callback(TEXT.manageButtons.clearCalled, `sm:${activeType}:call:${i}:clear`)],
      ] : []),
    ];

    if (session.type === 'personalRecitation' || session.type === 'groupRecitation') {
      buttons.push([Markup.button.callback(TEXT.manageButtons.editPage, `sm:${activeType}:editpage:${i}`)]);
    } else if (session.type === 'registeredSecondary') {
      buttons.push([Markup.button.callback(TEXT.manageButtons.editVerse, `sm:${activeType}:editverse:${i}`)]);
    }
    buttons.push([Markup.button.callback(TEXT.manageButtons.back, `sm:${activeType}:back:${i}`)]);

    await ctx.editMessageText(
      TEXT.managePickHeader(name, e, callState, showCall),
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
    ctx.answerCbQuery();
  }

  // ─── sm:set — apply attendance status ─────────────────────────────────────────
  async function setStatus(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[2], 10);
    const name   = names[i];
    const status = ctx.match[3];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    participants.setStatus(session, name, status);
    
    // If changed to present, assign page if needed
    if (status === 'present') {
      await assignPageIfNeeded(name, session, groupId);
    }
    // If changed away from present, delete page
    else if (participants.getPage(session, name)) {
      participants.clearPage(session, name);
    }

    // groupRecitation can recalc every page (multi-participant); others touch just this one.
    if (session.groupRecitation) {
      await saveSession(groupId, activeType, session);
    } else {
      await saveParticipant(groupId, activeType, session, name);
    }
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
    await refreshManageWidget(ctx, session, master, managePageOfIndex(i), activeType);
    ctx.answerCbQuery(TEXT.statusSet(name, st(status).a));
  }

  // ─── sm:call — mark/unmark called member ──────────────────────────────────────
  async function setCall(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[2], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);
    const state = ctx.match[3];

    participants.setCalled(session, name, state === 'clear' ? null : state);
    await saveParticipant(groupId, activeType, session, name);
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
    await refreshManageWidget(ctx, session, master, managePageOfIndex(i), activeType);
    ctx.answerCbQuery(
      state === 'responding' ? `👉 ${name} الآن قيد الرد.`
        : state === 'responded' ? `✅ تم تعليم ${name} بأنها حاضرة.`
        : state === 'away'      ? `📣 تم تعليم ${name} بأنها كانت بعيدة عن الميكروفون.`
        : `↩️ أزيلت علامة النداء عن ${name}.`
    );
  }

  // ─── sm:editpage — prompt to edit a member's page ─────────────────────────────
  async function editPage(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names  = rawSessionNames(session, master);
    const i      = parseInt(ctx.match[2], 10);
    const name   = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editPage', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, sessionType: activeType, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editPagePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الرقم', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editPage', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, sessionType: activeType, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  }

  // ─── sm:editverse — prompt to edit a member's verse (secondary session) ─────
  async function editVerse(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);

    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    if (session.type !== 'registeredSecondary') return ctx.answerCbQuery(TEXT.noSessionShort);

    const master = await getMaster(groupId);
    const names = rawSessionNames(session, master);
    const i = parseInt(ctx.match[2], 10);
    const name = names[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editVerse', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, sessionType: activeType, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editVersePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'مثال: 12-18', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editVerse', chatId: ctx.chat.id, msgId, memberName: name,
      memberIndex: i, sessionType: activeType, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  }

  // ─── sm:back / sm:page / sm:refresh / sm:hide / sm:addguest — navigation ──────
  async function backToIndex(ctx) {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    const index = parseInt(ctx.match[2], 10);
    await refreshManageWidget(ctx, session, master, managePageOfIndex(index), activeType);
  }

  async function back(ctx) {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    await refreshManageWidget(ctx, session, master, 0, activeType);
  }

  async function page(ctx) {
    await ctx.answerCbQuery();
    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return;
    const session = await getSession(groupId, activeType);
    if (!session) return;
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[2], 10);
    await refreshManageWidget(ctx, session, master, Number.isInteger(page) ? page : 0, activeType);
  }

  async function noop(ctx) {
    await ctx.answerCbQuery();
  }

  async function refreshPage(ctx) {
    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    const master = await getMaster(groupId);
    
    // Recalculate pages based on registration order (respects away/excused call status)
    await recalculatePagesFromRegistration(session, groupId);
    await saveSession(groupId, activeType, session);

    const page = parseInt(ctx.match[2], 10);
    await refreshManageWidget(ctx, session, master, Number.isInteger(page) ? page : 0, activeType);
    ctx.answerCbQuery(TEXT.refreshed);
  }

  async function refresh(ctx) {
    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);
    const master = await getMaster(groupId);

    await recalculatePagesFromRegistration(session, groupId);
    await saveSession(groupId, activeType, session);

    await refreshManageWidget(ctx, session, master, 0, activeType);
    ctx.answerCbQuery(TEXT.refreshed);
  }

  async function hide(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch { await ctx.editMessageText(TEXT.hiddenManageList); }
  }

  async function dismiss(ctx) {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logTelegramError('manage.dismiss.deleteMessage', err, {
        chatId: String(ctx.chat?.id || ''),
      });
    }
  }

  async function cancelAwaiting(ctx) {
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
  }

  async function addGuest(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'addGuest', chatId: ctx.chat.id, msgId, sessionType: activeType, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.addGuestPrompt, {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'اسم الضيفة', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'addGuest', chatId: ctx.chat.id, msgId, sessionType: activeType, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  }

  async function editName(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const scopedType = ctx.match[1] || null;
    const activeType = await resolveSessionType(groupId, scopedType);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionShort);
    const session = await getSession(groupId, activeType);
    if (!session) return ctx.answerCbQuery(TEXT.noSessionShort);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    const page = parseInt(ctx.match[2], 10);
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editSessionName', chatId: ctx.chat.id, msgId, promptMsgId: null,
      managePage: safePage, sessionType: activeType, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.editSessionNamePrompt(session.name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'اسم القائمة الجديد', selective: true },
    });
    await trackSessionBotMessage(groupId, activeType, session, prompt?.message_id);
    await setAwaiting(groupId, uid, {
      action: 'editSessionName', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id,
      managePage: safePage, sessionType: activeType, awaitingPrompt: false,
    });
  }

  return { choose, pick, setStatus, setCall, editPage, editVerse, backToIndex, back, page, noop, refreshPage, refresh, hide, dismiss, cancelAwaiting, addGuest, editName };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.action(/^sm:choose:([a-zA-Z]+)$/, h.choose);
  bot.action(/^sm:(?:([a-zA-Z]+):)?pick:(\d+)$/, h.pick);
  bot.action(/^sm:(?:([a-zA-Z]+):)?set:(\d+):(present|listening|excused|absent)$/, h.setStatus);
  bot.action(/^sm:(?:([a-zA-Z]+):)?call:(\d+):(responding|responded|away|clear)$/, h.setCall);
  bot.action(/^sm:(?:([a-zA-Z]+):)?editpage:(\d+)$/, h.editPage);
  bot.action(/^sm:(?:([a-zA-Z]+):)?editverse:(\d+)$/, h.editVerse);
  bot.action(/^sm:(?:([a-zA-Z]+):)?back:(\d+)$/, h.backToIndex);
  bot.action(/^sm:(?:([a-zA-Z]+):)?back$/, h.back);
  bot.action(/^sm:(?:([a-zA-Z]+):)?page:(\d+)$/, h.page);
  bot.action(/^sm:(?:([a-zA-Z]+):)?noop$/, h.noop);
  bot.action(/^sm:(?:([a-zA-Z]+):)?refresh:(\d+)$/, h.refreshPage);
  bot.action(/^sm:(?:([a-zA-Z]+):)?refresh$/, h.refresh);
  bot.action(/^sm:(?:([a-zA-Z]+):)?hide$/, h.hide);
  bot.action('msg:dismiss', h.dismiss);
  bot.action(/^aw:cancel:(\d+)$/, h.cancelAwaiting);
  bot.action(/^sm:(?:([a-zA-Z]+):)?addguest$/, h.addGuest);
  bot.action(/^sm:(?:([a-zA-Z]+):)?editname:(\d+)$/, h.editName);
}

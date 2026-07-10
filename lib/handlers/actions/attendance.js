import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError } from '../../helpers.js';
import { syncSessionNamesFromMaster } from '../../sessionSync.js';
import { TEXT, st } from '../../text.js';
import { refreshSessionWidget } from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getActiveSession, saveSession, getPageProgress } = storage;

  bot.action('a:refresh', async (ctx) => {
    if (!await isAdmin(ctx)) {
      return ctx.answerCbQuery(TEXT.adminOnly);
    }

    const groupId = groupIdFromCtx(ctx);
    const activeSession = await getActiveSession(groupId);
    const activeType = activeSession?.type || null;
    const session = activeSession?.session || null;
    if (!activeType || !session) return ctx.answerCbQuery(TEXT.noSessionActive);

    const master = await getMaster(groupId);
    const sync = syncSessionNamesFromMaster(session, master);
    if (sync.changed) {
      await saveSession(groupId, activeType, session);
    }
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_refresh_synced',
      groupId,
      sessionType: activeType,
      syncChanged: Boolean(sync.changed),
      syncKept: Number.isInteger(sync.kept) ? sync.kept : 0,
      syncAdded: Number.isInteger(sync.added) ? sync.added : 0,
      syncRemoved: Number.isInteger(sync.removed) ? sync.removed : 0,
      at: new Date().toISOString(),
    }));
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
    return ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action(/^a:(present|listening|excused)$/, async (ctx) => {
    const groupId = groupIdFromCtx(ctx);
    const clickedMessageId = ctx?.callbackQuery?.message?.message_id || null;
    const action = ctx.match[1];
    const activeSession = await getActiveSession(groupId);
    const activeType = activeSession?.type || null;
    const session = activeSession?.session || null;
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_action_received',
      groupId,
      activeType: activeType || null,
      action,
      clickedMessageId,
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    if (!activeType || !session) return ctx.answerCbQuery(TEXT.noSessionActive);

    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_session_selected',
      groupId,
      sessionType: activeType,
      sessionActive: Boolean(session?.active),
      registrationActive: session?.registrationActive,
      allowPublicRegistration: Boolean(session?.allowPublicRegistration),
      sessionMessageId: session?.messageId || null,
      clickedMessageId,
      messageMatch: Boolean(session?.messageId && clickedMessageId && Number(session.messageId) === Number(clickedMessageId)),
      at: new Date().toISOString(),
    }));
    if (!session?.active)
      return ctx.answerCbQuery(TEXT.noSessionActive);
    if (session.registrationActive === false) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'attendance_blocked_registration_closed',
        groupId,
        sessionType: activeType,
        clickedMessageId,
        sessionMessageId: session?.messageId || null,
        at: new Date().toISOString(),
      }));
      ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((err) => {
        logTelegramError('attendance.clearClosedRegistrationKeyboard', err, {
          groupId,
          sessionType: activeType,
        });
      });
      return ctx.answerCbQuery(TEXT.registrationClosedAlert);
    }

    const master = await getMaster(groupId);
    const uid    = String(ctx.from.id);
    const member = master.members.find(m => m.userId === uid);
    const status = ctx.match[1];

    if (!member) {
      if (!session.allowPublicRegistration)
        return ctx.answerCbQuery(TEXT.needRegistration);

      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
        || ctx.from.username || TEXT.noNameFallback;
      master.members.push({ userId: uid, name });
      await saveMaster(groupId, master);
      participants.register(session, name, { status, memberId: uid, registeredAt: Date.now() });

      if (session.type === 'personalRecitation') {
        if (status === 'present') {
          const progress = await getPageProgress(groupId);
          participants.setPage(session, name, (Number(progress[name]) || 0) + 1);
        }
        // listening/excused: no page assigned
      }

      if (session.type === 'groupRecitation' && status === 'present') {
        if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
        participants.setPage(session, name, session.groupRecitationStartPage);
        session.groupRecitationStartPage += 1;
      }

      await saveSession(groupId, activeType, session);
      console.log(JSON.stringify({
        level: 'info',
        event: 'attendance_saved_new_member',
        groupId,
        sessionType: activeType,
        action,
        memberName: name,
        userId: uid,
        at: new Date().toISOString(),
      }));
      await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
      let toast;
      if (session.type === 'personalRecitation' && status === 'present') {
        toast = TEXT.pageAssigned(name, participants.getPage(session, name));
      } else if (session.type === 'groupRecitation' && status === 'present') {
        toast = TEXT.pageAssignedGroupRecitation(name, participants.getPage(session, name));
      } else {
        toast = TEXT.registeredSelf(st(status).a);
      }
      return ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
    }

    participants.setStatus(session, member.name, status);
    participants.setMemberId(session, member.name, member.userId);
    participants.ensureRegisteredAt(session, member.name);

    if (session.type === 'personalRecitation') {
      if (status === 'present') {
        const existingPage = participants.getPage(session, member.name);
        if (existingPage !== undefined && existingPage !== null) {
          await saveSession(groupId, activeType, session);
          await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
          return ctx.answerCbQuery(TEXT.alreadyHasPage(existingPage));
        }
        const progress = await getPageProgress(groupId);
        participants.setPage(session, member.name, (Number(progress[member.name]) || 0) + 1);
      } else {
        // listening/excused: revert page assignment
        participants.clearPage(session, member.name);
      }
    }

    if (session.type === 'groupRecitation' && status === 'present') {
      if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
      const existingPage = participants.getPage(session, member.name);
      if (existingPage === undefined || existingPage === null) {
        participants.setPage(session, member.name, session.groupRecitationStartPage);
        session.groupRecitationStartPage += 1;
      }
    } else if (session.type === 'groupRecitation') {
      participants.clearPage(session, member.name);
    }

    await saveSession(groupId, activeType, session);
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_saved_existing_member',
      groupId,
      sessionType: activeType,
      action,
      memberName: member.name,
      userId: uid,
      at: new Date().toISOString(),
    }));
    await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
    let toast;
    if (session.type === 'personalRecitation' && status === 'present') {
      toast = TEXT.pageAssigned(member.name, participants.getPage(session, member.name));
    } else if (session.type === 'groupRecitation' && status === 'present') {
      const page = participants.getPage(session, member.name);
      toast = page
        ? TEXT.pageAssignedGroupRecitation(member.name, page)
        : TEXT.registeredAs(st(status).a);
    } else {
      toast = TEXT.registeredAs(st(status).a);
    }
    ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
  });
}

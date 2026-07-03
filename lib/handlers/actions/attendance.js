import { groupIdFromCtx, logTelegramError } from '../../helpers.js';
import { TEXT, st } from '../../text.js';
import { refreshSessionWidget } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getActiveSession, saveSession, getPageProgress } = storage;

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
      session.attendance[name] = status;
      if (!session.registrationTimes) session.registrationTimes = {};
      session.registrationTimes[name] = Date.now();

      if (session.type === 'personalRecitation') {
        if (status === 'present') {
          const progress = await getPageProgress(groupId);
          if (!session.pages) session.pages = {};
          session.pages[name] = (Number(progress[name]) || 0) + 1;
        }
        // listening/excused: no page assigned
      }

      if (session.type === 'groupRecitation' && status === 'present') {
        if (!session.pages) session.pages = {};
        if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
        session.pages[name] = session.groupRecitationStartPage;
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
        toast = TEXT.pageAssigned(name, session.pages[name]);
      } else if (session.type === 'groupRecitation' && status === 'present') {
        toast = TEXT.pageAssignedGroupRecitation(name, session.pages[name]);
      } else {
        toast = TEXT.registeredSelf(st(status).a);
      }
      return ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
    }

    session.attendance[member.name] = status;
    if (!session.registrationTimes) session.registrationTimes = {};
    if (!session.registrationTimes[member.name]) session.registrationTimes[member.name] = Date.now();

    if (session.type === 'personalRecitation') {
      if (status === 'present') {
        if (session.pages[member.name] !== undefined && session.pages[member.name] !== null) {
          await saveSession(groupId, activeType, session);
          await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, activeType, session));
          return ctx.answerCbQuery(TEXT.alreadyHasPage(session.pages[member.name]));
        }
        const progress = await getPageProgress(groupId);
        if (!session.pages) session.pages = {};
        session.pages[member.name] = (Number(progress[member.name]) || 0) + 1;
      } else {
        // listening/excused: revert page assignment
        delete session.pages[member.name];
      }
    }

    if (session.type === 'groupRecitation' && status === 'present') {
      if (!session.pages) session.pages = {};
      if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
      if (session.pages[member.name] === undefined || session.pages[member.name] === null) {
        session.pages[member.name] = session.groupRecitationStartPage;
        session.groupRecitationStartPage += 1;
      }
    } else if (session.type === 'groupRecitation' && session.pages && member.name in session.pages) {
      delete session.pages[member.name];
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
      toast = TEXT.pageAssigned(member.name, session.pages[member.name]);
    } else if (session.type === 'groupRecitation' && status === 'present') {
      toast = session.pages[member.name]
        ? TEXT.pageAssignedGroupRecitation(member.name, session.pages[member.name])
        : TEXT.registeredAs(st(status).a);
    } else {
      toast = TEXT.registeredAs(st(status).a);
    }
    ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
  });
}

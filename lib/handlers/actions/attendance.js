import { groupIdFromCtx } from '../../helpers.js';
import { TEXT, st } from '../../text.js';
import { refreshSessionWidget } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getSession, saveSession, getPageProgress } = storage;

  bot.action(/^a:(present|listening|excused)$/, async (ctx) => {
    const groupId = groupIdFromCtx(ctx);
    const session = await getSession(groupId);
    if (!session?.active)
      return ctx.answerCbQuery(TEXT.noSessionActive, { show_alert: true });
    if (session.registrationOpen === false)
      return ctx.answerCbQuery(TEXT.registrationClosedAlert, { show_alert: true });

    const master = await getMaster(groupId);
    const uid    = String(ctx.from.id);
    const member = master.members.find(m => m.userId === uid);
    const status = ctx.match[1];

    if (!member) {
      if (!session.openRegistration)
        return ctx.answerCbQuery(TEXT.needRegistration, { show_alert: true });

      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
        || ctx.from.username || TEXT.noNameFallback;
      master.members.push({ userId: uid, name });
      await saveMaster(groupId, master);
      session.attendance[name] = status;

      if (session.pageList) {
        if (status === 'present') {
          const progress = await getPageProgress(groupId);
          session.pages[name] = (Number(progress[name]) || 0) + 1;
        }
        // listening/excused: no page assigned
      }

      if (session.groupRecitation && status === 'present') {
        if (!session.pages) session.pages = {};
        if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
        session.pages[name] = session.groupRecitationStartPage;
        session.groupRecitationStartPage += 1;
      }

      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master);
      let toast;
      if (session.pageList && status === 'present') {
        toast = TEXT.pageAssigned(name, session.pages[name]);
      } else if (session.groupRecitation && status === 'present') {
        toast = TEXT.pageAssignedGroupRecitation(name, session.pages[name]);
      } else {
        toast = TEXT.registeredSelf(st(status).a);
      }
      return ctx.answerCbQuery(toast, { show_alert: session.pageList && status === 'present' });
    }

    session.attendance[member.name] = status;

    if (session.pageList) {
      if (status === 'present') {
        if (session.pages[member.name] !== undefined && session.pages[member.name] !== null) {
          await saveSession(groupId, session);
          await refreshSessionWidget(bot.telegram, session, master);
          return ctx.answerCbQuery(TEXT.alreadyHasPage(session.pages[member.name]), { show_alert: true });
        }
        const progress = await getPageProgress(groupId);
        session.pages[member.name] = (Number(progress[member.name]) || 0) + 1;
      } else {
        // listening/excused: revert page assignment
        delete session.pages[member.name];
      }
    }

    if (session.groupRecitation && status === 'present') {
      if (!session.pages) session.pages = {};
      if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
      if (session.pages[member.name] === undefined || session.pages[member.name] === null) {
        session.pages[member.name] = session.groupRecitationStartPage;
        session.groupRecitationStartPage += 1;
      }
    } else if (session.groupRecitation && session.pages && member.name in session.pages) {
      delete session.pages[member.name];
    }

    await saveSession(groupId, session);
    await refreshSessionWidget(bot.telegram, session, master);
    let toast;
    if (session.pageList && status === 'present') {
      toast = TEXT.pageAssigned(member.name, session.pages[member.name]);
    } else if (session.groupRecitation && status === 'present') {
      toast = session.pages[member.name]
        ? TEXT.pageAssignedGroupRecitation(member.name, session.pages[member.name])
        : TEXT.registeredAs(st(status).a);
    } else {
      toast = TEXT.registeredAs(st(status).a);
    }
    ctx.answerCbQuery(toast, { show_alert: session.pageList && status === 'present' });
  });
}

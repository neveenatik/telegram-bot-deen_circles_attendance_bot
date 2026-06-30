import { isAdmin } from '../../guards.js';
import { groupIdFromCtx } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { refreshSessionWidget, rawSessionNames, sessionNames, manageText, manageKb } from '../../widgets.js';

export function register(bot, storage) {
  const {
    getMaster, getSession, saveSession, clearSession, archiveSession,
    getPageProgress, savePageProgress,
    getGroupRecitationNextPage, saveGroupRecitationNextPage,
  } = storage;

  bot.command('stopregistration', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const session = await getSession(groupId);
    if (!session) return ctx.reply(TEXT.noSessionActive);
    if (session.registrationOpen === false)
      return ctx.reply(TEXT.registrationAlreadyStopped);

    session.registrationOpen = false;
    await saveSession(groupId, session);
    const master = await getMaster(groupId);
    await refreshSessionWidget(bot.telegram, session, master);
    ctx.reply(TEXT.registrationStopped);
  });

  bot.command('stoplist', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const session = await getSession(groupId);
    if (!session) return ctx.reply(TEXT.noSessionActive);

    const master = await getMaster(groupId);

    const absentBase = rawSessionNames(session, master);
    for (const name of absentBase) {
      if (!session.attendance[name]) session.attendance[name] = 'absent';
    }
    session.active  = false;
    session.endedAt = new Date().toISOString();
    session.endedBy = ctx.from.id;

    await refreshSessionWidget(bot.telegram, session, master);
    try { await ctx.unpinChatMessage(session.messageId); } catch (_) {}

    await archiveSession(groupId, session);
    await clearSession(groupId);

    // Save page progress — only for members who were actually called
    if ((session.pageList || session.groupRecitation) && session.pages) {
      const progress = await getPageProgress(groupId);
      for (const [name, page] of Object.entries(session.pages)) {
        const hasCallStatus = session.called && session.called[name];
        if (hasCallStatus && page && Number.isInteger(page)) progress[name] = page;
      }
      await savePageProgress(groupId, progress);
    }

    // Save next page for group recitation (only count students who were called)
    if (session.groupRecitation && session.pages) {
      let maxPage = 0;
      for (const [name, page] of Object.entries(session.pages)) {
        const hasCallStatus = session.called && session.called[name];
        if (hasCallStatus && Number.isInteger(page) && page > maxPage) maxPage = page;
      }
      await saveGroupRecitationNextPage(groupId, maxPage > 0 ? maxPage + 1 : 1);
    }

    const groups = { present: [], listening: [], excused: [], absent: [] };
    for (const n of sessionNames(session, master)) {
      const k = session.attendance[n] || 'absent';
      (groups[k] || groups.absent).push(n);
    }

    if (session.pageList) {
      ctx.replyWithMarkdown(TEXT.pageListReport(session));
    } else if (session.groupRecitation) {
      ctx.replyWithMarkdown(TEXT.groupRecitationReport(session));
    } else {
      ctx.replyWithMarkdown(TEXT.report(session, groups));
    }
  });

  bot.command('editlist', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const session = await getSession(groupId);
    if (!session) return ctx.reply(TEXT.noSessionActive);
    const master = await getMaster(groupId);
    ctx.replyWithMarkdown(manageText(session, master), manageKb(session, master));
  });
}

import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyChunked, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { refreshSessionWidget, rawSessionNames, sessionNames, manageText, manageKb } from '../../widgets.js';

export function register(bot, storage) {
  const {
    getMaster, getSession, saveSession, clearSession, archiveSession,
    getPageProgress, savePageProgress,
    getGroupRecitationNextPage, saveGroupRecitationNextPage,
  } = storage;

  // Helper to find which session type is active
  async function getActiveSessionType(groupId) {
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const session = await getSession(groupId, type);
      if (session && session.active) return type;
    }
    return null;
  }

  bot.command('stopregistration', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
    
    const session = await getSession(groupId, activeType);
    if (session.registrationActive === false)
      return replyEphemeral(ctx, TEXT.registrationAlreadyStopped);

    session.registrationActive = false;
    await saveSession(groupId, activeType, session);
    const master = await getMaster(groupId);
    await refreshSessionWidget(bot.telegram, session, master);
    replyEphemeral(ctx, TEXT.registrationStopped);
  });

  bot.command('stoplist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
    
    const session = await getSession(groupId, activeType);

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

    await archiveSession(groupId, activeType, session);
    await clearSession(groupId, activeType);

    // Save page progress — only for members who were actually called
    if ((session.type === 'personalRecitation' || session.type === 'groupRecitation') && session.pages) {
      const progress = await getPageProgress(groupId);
      for (const [name, page] of Object.entries(session.pages)) {
        const hasCallStatus = session.called && session.called[name];
        if (hasCallStatus && page && Number.isInteger(page)) progress[name] = page;
      }
      await savePageProgress(groupId, progress);
    }

    // Save next page for group recitation (only count students who were called)
    if (session.type === 'groupRecitation' && session.pages) {
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

    if (session.type === 'personalRecitation') {
      await replyChunked(ctx, TEXT.pageListReport(session), { parse_mode: 'Markdown' });
    } else if (session.type === 'groupRecitation') {
      await replyChunked(ctx, TEXT.groupRecitationReport(session), { parse_mode: 'Markdown' });
    } else if (session.type === 'registeredSecondary') {
      await replyChunked(ctx, TEXT.secondaryReport(session), { parse_mode: 'Markdown' });
    } else {
      await replyChunked(ctx, TEXT.report(session, groups), { parse_mode: 'Markdown' });
    }
  });

  bot.command('editlist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
    
    const session = await getSession(groupId, activeType);
    const master = await getMaster(groupId);
    ctx.replyWithMarkdown(manageText(session, master), manageKb(session, master));
  });
}

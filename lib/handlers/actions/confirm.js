import { isCreator } from '../../guards.js';
import { TEXT } from '../../text.js';
import { getPendingConfirm, deletePendingConfirm } from '../../confirmations.js';
import { refreshSessionWidget } from '../../widgets.js';

async function executePendingConfirm(pending, storage, telegram) {
  const {
    getSessions, saveSessions, getCurrentSeries, saveCurrentSeries,
    getMaster, saveMaster, getSession, saveSession,
  } = storage;

  if (pending.action === 'closeSeries') {
    const { current, groupId } = pending;
    const next = current + 1;
    await saveCurrentSeries(groupId, next);
    return { text: TEXT.closeSeriesDone(current, next), parse_mode: 'Markdown' };
  }

  if (pending.action === 'removeRecord') {
    const { groupId, sessionType, recordIndex } = pending;
    const all = await getSessions(groupId, sessionType);
    // Find the session within the type's sessions by matching the seriesId-scoped index
    const currentSeries = await getCurrentSeries(groupId);
    const scoped = all.filter(s => (s.seriesId || 1) === currentSeries);
    const target = scoped[recordIndex - 1];
    if (!target) return { text: TEXT.invalidRecordIndex };
    const absoluteIdx = all.indexOf(target);
    all.splice(absoluteIdx, 1);
    await saveSessions(groupId, sessionType, all);
    return { text: TEXT.recordDeleted(recordIndex) };
  }

  if (pending.action === 'removeMemberRecord') {
    const { groupId, sessionType, recordIndex, name } = pending;
    const all = await getSessions(groupId, sessionType);
    const currentSeries = await getCurrentSeries(groupId);
    const scoped = all.filter(s => (s.seriesId || 1) === currentSeries);
    const target = scoped[recordIndex - 1];
    if (!target) return { text: TEXT.invalidRecordIndex };
    if (target?.attendance) delete target.attendance[name];
    await saveSessions(groupId, sessionType, all);
    return { text: TEXT.memberRecordDeleted(name, recordIndex), parse_mode: 'Markdown' };
  }

  if (pending.action === 'removeAllStudents') {
    const { groupId } = pending;
    const master = await getMaster(groupId);
    const names = Array.isArray(master?.members) ? master.members.map((m) => m.name) : [];
    if (!names.length) return { text: TEXT.noStudentsToRemove };

    master.members = [];
    await saveMaster(groupId, master);

    const sessionTypes = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of sessionTypes) {
      const session = await getSession(groupId, type);
      if (!session) continue;

      for (const name of names) {
        if (session.attendance) delete session.attendance[name];
        if (session.called) delete session.called[name];
        if (session.pages) delete session.pages[name];
        if (session.registrationTimes) delete session.registrationTimes[name];
        if (session.verses) delete session.verses[name];
      }

      await saveSession(groupId, type, session);
      if (session.active && telegram) {
        await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    return { text: TEXT.allStudentsRemoved(names.length), parse_mode: 'Markdown' };
  }

  return { text: '✅' };
}

export function register(bot, storage) {
  bot.action(/^cf:(ok|cancel):([A-Z0-9]{6})$/, async (ctx) => {
    if (!await isCreator(ctx))
      return ctx.answerCbQuery(TEXT.creatorOnly);

    const mode  = ctx.match[1];
    const token = ctx.match[2];
    const pending = getPendingConfirm(token);
    if (!pending)
      return ctx.answerCbQuery(TEXT.confirmNotFound);
    if (pending.userId !== String(ctx.from.id))
      return ctx.answerCbQuery(TEXT.confirmNotOwner);
    if (pending.expiresAt < Date.now()) {
      deletePendingConfirm(token);
      return ctx.answerCbQuery(TEXT.confirmExpired);
    }

    if (mode === 'cancel') {
      deletePendingConfirm(token);
      await ctx.editMessageText(TEXT.confirmCancelled);
      return ctx.answerCbQuery();
    }

    deletePendingConfirm(token);
    const result = await executePendingConfirm(pending, storage, bot.telegram);
    await ctx.editMessageText(result.text, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
    return ctx.answerCbQuery();
  });
}

import { isCreator } from '../../guards.js';
import { TEXT } from '../../text.js';
import { getPendingConfirm, deletePendingConfirm } from '../../confirmations.js';

async function executePendingConfirm(pending, storage) {
  const { getSessions, saveSessions, getCurrentSeries, saveCurrentSeries, getAllSessions } = storage;

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
    const result = await executePendingConfirm(pending, storage);
    await ctx.editMessageText(result.text, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
    return ctx.answerCbQuery();
  });
}

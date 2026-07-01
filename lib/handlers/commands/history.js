import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, sortArabic } from '../../helpers.js';
import { setPendingConfirm } from '../../confirmations.js';
import { TEXT } from '../../text.js';
import { confirmKb } from '../../widgets.js';

function sessionSeries(s) {
  return Number.isInteger(s?.seriesId) && s.seriesId > 0 ? s.seriesId : 1;
}
function sessionsInSeries(sessions, seriesId) {
  return sessions.filter((s) => sessionSeries(s) === seriesId);
}

export function register(bot, storage) {
  const { getMaster, getSession, getAllSessions, getCurrentSeries, saveSessions, getSessions } = storage;

  bot.command('classhistory', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const scoped = sessionsInSeries(all, currentSeries);
    if (!scoped.length) return ctx.reply(TEXT.noSeriesRecords(currentSeries));

    const lines = scoped.map((s, i) => TEXT.recordsLine(i + 1, s));
    return ctx.reply(`${TEXT.recordsHeader(currentSeries, scoped.length)}\n\n${lines.join('\n')}`);
  });

  bot.command('studentshistory', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const sessions = sessionsInSeries(all, currentSeries);
    if (!sessions.length) return ctx.reply(TEXT.historyEmpty);
    const master = await getMaster(groupId);
    const tally  = {};
    for (const name of master.members.map(m => m.name)) {
      tally[name] = { present: 0, listening: 0, excused: 0, absent: 0 };
    }
    for (const s of sessions) {
      for (const [name, key] of Object.entries(s.attendance || {})) {
        if (tally[name] && key in tally[name]) tally[name][key]++;
      }
    }
    const lines = sortArabic(Object.keys(tally)).map((name) => {
      const t = tally[name];
      return TEXT.historyLine(name, t.present, t.listening, t.excused, t.absent);
    });
    ctx.reply(`${TEXT.historyHeader(sessions.length)}\n\n${lines.join('\n\n')}`);
  });

  bot.command('newclass', async (ctx) => {
    if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const session = await getSession(groupId, type);
      if (session && session.active) return ctx.reply(TEXT.closeSeriesNeedsNoActiveSession);
    }

    const current = await getCurrentSeries(groupId);
    const token = setPendingConfirm(ctx.from.id, { action: 'closeSeries', current, groupId });
    return ctx.replyWithMarkdown(
      TEXT.confirmPrompt(`إغلاق السلسلة ${current} وبدء سلسلة جديدة`),
      confirmKb(token)
    );
  });

  bot.command('removeclassrecord', async (ctx) => {
    if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const idx = parseInt(raw, 10);
    if (!Number.isInteger(idx) || idx < 1) return ctx.reply(TEXT.invalidRecordIndex);

    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const scopedAbs = all
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => sessionSeries(s) === currentSeries);
    const picked = scopedAbs[idx - 1];
    if (!picked) return ctx.reply(TEXT.invalidRecordIndex);

    const token = setPendingConfirm(ctx.from.id, {
      action: 'removeRecord',
      groupId,
      sessionType: picked.s.type,
      recordIndex: idx,
    });
    return ctx.replyWithMarkdown(TEXT.confirmPrompt(`حذف السجل #${idx}`), confirmKb(token));
  });

  bot.command('removestudentrecord', async (ctx) => {
    if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const parts = raw.split('|').map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return ctx.reply(TEXT.invalidRemoveMemberRecordFormat);

    const idx = parseInt(parts[0], 10);
    const name = parts[1];
    if (!Number.isInteger(idx) || idx < 1) return ctx.reply(TEXT.invalidRecordIndex);

    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const scopedAbs = all
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => sessionSeries(s) === currentSeries);
    const picked = scopedAbs[idx - 1];
    if (!picked) return ctx.reply(TEXT.invalidRecordIndex);
    if (!picked.s.attendance || !(name in picked.s.attendance))
      return ctx.reply(TEXT.recordMemberNotFound(name), { parse_mode: 'Markdown' });

    const token = setPendingConfirm(ctx.from.id, {
      action: 'removeMemberRecord',
      groupId,
      sessionType: picked.s.type,
      recordIndex: idx,
      name,
    });
    return ctx.replyWithMarkdown(
      TEXT.confirmPrompt(`حذف سجل ${name} من السجل #${idx}`),
      confirmKb(token)
    );
  });
}

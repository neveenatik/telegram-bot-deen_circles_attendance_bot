import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, sortArabic, replyChunked, replyEphemeral } from '../../helpers.js';
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
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    
    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const querySeries = arg ? parseInt(arg, 10) : currentSeries;
    
    if (arg && (!Number.isInteger(querySeries) || querySeries < 1)) {
      return replyEphemeral(ctx, TEXT.invalidSeriesNumber);
    }

    const scoped = sessionsInSeries(all, querySeries);
    if (!scoped.length) return replyEphemeral(ctx, TEXT.noSeriesRecords(querySeries));

    const lines = scoped.map((s, i) => TEXT.recordsLine(i + 1, s));
    return replyChunked(ctx, `${TEXT.recordsHeader(querySeries, scoped.length)}\n\n${lines.join('\n')}`);
  });

  bot.command('studentshistory', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    
    const optionalArgs = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const querySeries = optionalArgs ? parseInt(optionalArgs, 10) : currentSeries;
    
    if (optionalArgs && (!Number.isInteger(querySeries) || querySeries < 1)) {
      return replyEphemeral(ctx, TEXT.invalidSeriesNumber);
    }

    const sessions = sessionsInSeries(all, querySeries).filter((s) => s.type === 'main');
    if (!sessions.length) return replyEphemeral(ctx, TEXT.historyEmpty);
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
    return replyChunked(ctx, `${TEXT.historyHeader(sessions.length)}\n\n${lines.join('\n\n')}`);
  });

  bot.command('newclass', async (ctx) => {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const session = await getSession(groupId, type);
      if (session && session.active) return replyEphemeral(ctx, TEXT.closeSeriesNeedsNoActiveSession);
    }

    const current = await getCurrentSeries(groupId);
    const token = setPendingConfirm(ctx.from.id, { action: 'closeSeries', current, groupId });
    return ctx.replyWithMarkdown(
      TEXT.confirmPrompt(`إغلاق الدورة الحالية ${current} وبدء دورة جديدة`),
      confirmKb(token)
    );
  });

  bot.command('removeclassrecord', async (ctx) => {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const idx = parseInt(raw, 10);
    if (!Number.isInteger(idx) || idx < 1) return replyEphemeral(ctx, TEXT.invalidRecordIndex);

    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const scopedAbs = all
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => sessionSeries(s) === currentSeries);
    const picked = scopedAbs[idx - 1];
    if (!picked) return replyEphemeral(ctx, TEXT.invalidRecordIndex);

    const token = setPendingConfirm(ctx.from.id, {
      action: 'removeRecord',
      groupId,
      sessionType: picked.s.type,
      recordIndex: idx,
    });
    return ctx.replyWithMarkdown(TEXT.confirmPrompt(`حذف السجل #${idx}`), confirmKb(token));
  });

  bot.command('removestudentrecord', async (ctx) => {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const parts = raw.split('|').map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return replyEphemeral(ctx, TEXT.invalidRemoveMemberRecordFormat);

    const idx = parseInt(parts[0], 10);
    const name = parts[1];
    if (!Number.isInteger(idx) || idx < 1) return replyEphemeral(ctx, TEXT.invalidRecordIndex);

    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const scopedAbs = all
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => sessionSeries(s) === currentSeries);
    const picked = scopedAbs[idx - 1];
    if (!picked) return replyEphemeral(ctx, TEXT.invalidRecordIndex);
    if (!picked.s.attendance || !(name in picked.s.attendance))
      return replyEphemeral(ctx, TEXT.recordMemberNotFound(name), { parse_mode: 'Markdown' });

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

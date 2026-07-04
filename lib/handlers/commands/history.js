import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, sortArabic, replyChunked, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
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
  const { getMaster, getSession, getAllSessions, getCurrentSeries, saveSessions, getSessions, getTrainingGroups } = storage;

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

    const indexed = scoped.map((s, i) => ({ session: s, index: i + 1 }));
    const typeOrder = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    const typeTitle = {
      main: '📘 حلقات المسجلات الأساسية',
      open: '📗 حلقات التسجيل العام',
      registeredSecondary: '🧾 حلقات تصحيح التلاوة',
      personalRecitation: '📄 حلقات التلاوة الفردية',
      groupRecitation: '📖 حلقات التلاوة الجماعية',
      other: '🗂️ أخرى',
    };

    const sections = [];
    for (const type of typeOrder) {
      const rows = indexed.filter(({ session }) => session.type === type);
      if (!rows.length) continue;
      const lines = rows.map(({ session, index }) => TEXT.recordsLine(index, session));
      sections.push(`${typeTitle[type]} (${rows.length})\n${lines.join('\n')}`);
    }

    const otherRows = indexed.filter(({ session }) => !typeOrder.includes(session.type));
    if (otherRows.length) {
      const lines = otherRows.map(({ session, index }) => TEXT.recordsLine(index, session));
      sections.push(`${typeTitle.other} (${otherRows.length})\n${lines.join('\n')}`);
    }

    return replyChunked(ctx, `${TEXT.recordsHeader(querySeries, scoped.length)}\n\n${sections.join('\n\n')}`);
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

    // Main group attendance tally
    const tally = {};
    for (const name of master.members.map(m => m.name)) {
      tally[name] = { present: 0, listening: 0, excused: 0, absent: 0 };
    }
    for (const s of sessions) {
      for (const [name, key] of Object.entries(s.attendance || {})) {
        if (tally[name] && key in tally[name]) tally[name][key]++;
      }
    }

    // Latest secondary verse per student
    const latestVerses = {};
    const secondarySessions = sessionsInSeries(all, querySeries).filter((s) => s.type === 'registeredSecondary');
    for (const s of secondarySessions) {
      for (const [name, verse] of Object.entries(s.verses || {})) {
        if (typeof verse === 'string' && verse.trim()) latestVerses[name] = verse;
      }
    }

    // Training group attendance tally per student
    const trainingGroups = await getTrainingGroups(groupId);
    const userTrainingGroup = {};
    for (const tg of trainingGroups) {
      const tgMaster = await getMaster(tg.groupId);
      for (const m of (tgMaster.members || [])) {
        userTrainingGroup[String(m.userId)] = tg;
      }
    }
    const nameToTrainingGroup = {};
    for (const m of master.members) {
      const tg = userTrainingGroup[String(m.userId)];
      if (tg) nameToTrainingGroup[m.name] = tg;
    }
    const trainingSessionsByGroup = {};
    for (const tg of trainingGroups) {
      const tgAll = await getAllSessions(tg.groupId);
      trainingSessionsByGroup[tg.groupId] = sessionsInSeries(tgAll, querySeries).filter((s) => s.type === 'main');
    }
    const trainingTally = {};
    for (const name of master.members.map(m => m.name)) {
      const tg = nameToTrainingGroup[name];
      trainingTally[name] = { present: 0, listening: 0, excused: 0, absent: 0, groupName: tg?.name || null };
      if (!tg) continue;
      for (const s of (trainingSessionsByGroup[tg.groupId] || [])) {
        const key = (s.attendance || {})[name];
        if (key && key in trainingTally[name]) trainingTally[name][key]++;
      }
    }

    const lines = sortArabic(Object.keys(tally)).map((name) => {
      const verse = typeof latestVerses[name] === 'string' && latestVerses[name].trim() ? latestVerses[name] : '—';
      return TEXT.historyLine(name, tally[name], trainingTally[name], verse);
    });
    return replyChunked(ctx, `${TEXT.historyHeader(sessions.length)}\n\n${lines.join('\n\n')}`);
  });

  bot.command('newclass', async (ctx) => {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    for (const type of ACTIVE_SESSION_TYPES) {
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

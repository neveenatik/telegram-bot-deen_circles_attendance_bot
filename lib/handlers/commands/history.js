import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, sortArabic, replyChunked, replyEphemeral, logTelegramError } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { setPendingConfirm } from '../../confirmations.js';
import { TEXT } from '../../text.js';
import { confirmKb } from '../../widgets.js';
import { sessionSeries, sessionsInSeries, parseSeriesArg } from '../../historyUtils.js';
import { historyHomeKb } from '../actions/history.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage, telegram }) {
  const { getMaster, getSession, getAllSessions, getSessionParticipants, getCurrentSeries, getTrainingGroups, getClassTimezone } = storage;

  // getAllSessions returns metadata-only records; load participants on demand
  // for just the sessions an aggregate actually tallies.
  async function hydrateAll(groupId, sessions) {
    const list = (sessions || []).filter(Boolean);
    if (!list.length) return sessions;
    const map = await getSessionParticipants(groupId, list.map((s) => s.id));
    for (const s of list) s.participants = map[s.id] || {};
    return sessions;
  }

  async function classhistory(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const all = await getAllSessions(groupId);
    const currentSeries = await getCurrentSeries(groupId);

    const parsed = parseSeriesArg(ctx.message.text, currentSeries);
    if (!parsed.ok) return replyEphemeral(ctx, TEXT.invalidSeriesNumber);
    const querySeries = parsed.series;

    const scoped = sessionsInSeries(all, querySeries);
    if (!scoped.length) return replyEphemeral(ctx, TEXT.noSeriesRecords(querySeries));

    // The class-history panel is an admin control surface — deliver it privately
    // so taps can't hit the wrong record in the busy group. Buttons carry the
    // group id, so every edit still applies to this group's records.
    try {
      await telegram.sendMessage(ctx.from.id, TEXT.historyHomeText(querySeries, scoped.length), {
        parse_mode: 'Markdown',
        ...historyHomeKb(groupId, querySeries),
      });
      await replyEphemeral(ctx, TEXT.panelSentToDm);
    } catch (err) {
      let username = ctx.botInfo?.username;
      if (!username) {
        try { username = (await telegram.getMe())?.username; } catch { username = null; }
      }
      const link = username ? `https://t.me/${username}?start=classhistory` : null;
      await replyEphemeral(ctx, TEXT.startBotInDmNudge(link));
      logTelegramError('history.classhistory.dmSend', err, { chatId: String(groupId) });
    }
  }

  async function studentshistory(ctx) {
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
    await hydrateAll(groupId, sessions);
    const master = await getMaster(groupId);

    // Main group attendance tally
    const tally = {};
    for (const name of master.members.map(m => m.name)) {
      tally[name] = { present: 0, listening: 0, excused: 0, absent: 0 };
    }
    for (const s of sessions) {
      for (const name of participants.names(s)) {
        const key = participants.getStatus(s, name);
        if (key && tally[name] && key in tally[name]) tally[name][key]++;
      }
    }

    // Latest secondary verse per student
    const latestVerses = {};
    const secondarySessions = sessionsInSeries(all, querySeries).filter((s) => s.type === 'registeredSecondary');
    await hydrateAll(groupId, secondarySessions);
    for (const s of secondarySessions) {
      for (const name of participants.names(s)) {
        const verse = participants.getVerse(s, name);
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
      trainingSessionsByGroup[tg.groupId] = sessionsInSeries(tgAll, querySeries).filter((s) => s.type === 'training' || s.type === 'main');
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
    const tz = getClassTimezone ? await getClassTimezone(groupId).catch(() => 'Africa/Cairo') : 'Africa/Cairo';
    return replyChunked(ctx, `${TEXT.historyHeader(sessions.length, tz)}\n\n${lines.join('\n\n')}`);
  }

  async function newclass(ctx) {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) return replyEphemeral(ctx, TEXT.closeSeriesNeedsNoActiveSession);
    }

    const current = await getCurrentSeries(groupId);
    const token = setPendingConfirm(ctx.from.id, { action: 'closeSeries', current, groupId });
    return ctx.replyWithMarkdown(
      TEXT.confirmPrompt(TEXT.closeSeriesConfirmAction(current)),
      confirmKb(token)
    );
  }

  async function removeclassrecord(ctx) {
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
    return ctx.replyWithMarkdown(TEXT.confirmPrompt(TEXT.removeRecordConfirmAction(idx)), confirmKb(token));
  }

  async function removestudentrecord(ctx) {
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
      TEXT.confirmPrompt(TEXT.removeMemberRecordConfirmAction(name, idx)),
      confirmKb(token)
    );
  }

  return { classhistory, studentshistory, newclass, removeclassrecord, removestudentrecord };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('classhistory', h.classhistory);
  bot.command('studentshistory', h.studentshistory);
  bot.command('newclass', h.newclass);
  bot.command('removeclassrecord', h.removeclassrecord);
  bot.command('removestudentrecord', h.removestudentrecord);
}

import { Markup } from 'telegraf';
import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic, replyChunked } from '../../helpers.js';
import { TEXT, st } from '../../text.js';
import { sessionsInSeries, archivedSessionKey, clampButtonLabel } from '../../historyUtils.js';
import { sendSessionReport } from '../commands/stop.js';

function historyHomeKb(series) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.historyShowReportButton, `h:rep:${series}`)],
    [Markup.button.callback(TEXT.historyEditSessionsButton, `h:edit:${series}:0`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ]);
}

function buildClassHistoryReport(scoped) {
  const indexed = scoped.map((s, i) => ({ session: s, index: i + 1 }));
  const typeOrder = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
  const typeTitle = {
    main: TEXT.historyTypeTitle.main,
    open: TEXT.historyTypeTitle.open,
    registeredSecondary: TEXT.historyTypeTitle.registeredSecondary,
    personalRecitation: TEXT.historyTypeTitle.personalRecitation,
    groupRecitation: TEXT.historyTypeTitle.groupRecitation,
    other: TEXT.historyTypeTitle.other,
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

  return sections.join('\n\n');
}

function editSessionsText(series, count, page, totalPages) {
  return TEXT.historyEditSessionsText(series, count, page + 1, totalPages);
}

function editSessionKb(scoped, series, page = 0, pageSize = 8) {
  const totalPages = Math.max(1, Math.ceil(scoped.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const rows = scoped.slice(start, start + pageSize).map((s, i) => {
    const absoluteIndex = start + i + 1;
    const date = new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
    const label = clampButtonLabel(`${absoluteIndex}. ${s.name} | ${date}`);
    return [Markup.button.callback(label, `h:session:${series}:${absoluteIndex}:0`)];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `h:edit:${series}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'h:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `h:edit:${series}:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([
    Markup.button.callback(TEXT.backButton, `h:home:${series}`),
    Markup.button.callback(TEXT.closeButton, 'msg:dismiss'),
  ]);

  return { safePage, totalPages, keyboard: Markup.inlineKeyboard(rows) };
}

function sessionEditorText(recordIndex, session, names, page, totalPages) {
  const date = new Date(session.endedAt || session.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
  const head = [TEXT.historySessionEditorHeader(recordIndex), `${session.name} | ${date}`, `📄 صفحة ${page + 1}/${totalPages}`, ''];
  const start = page * 8;
  const body = names.slice(start, start + 8).map((name, i) => {
    const status = session.attendance?.[name] || null;
    return `${start + i + 1}. ${st(status).e} ${name}`;
  });
  return [...head, ...(body.length ? body : [TEXT.historySessionEditorEmpty])].join('\n');
}

function sessionEditorKb(series, recordIndex, session, page = 0, pageSize = 8) {
  const names = sortArabic(Object.keys(session?.attendance || {}));
  const totalPages = Math.max(1, Math.ceil(names.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;

  const rows = names.slice(start, start + pageSize).map((name, i) => {
    const memberIndex = start + i;
    const status = session.attendance?.[name] || null;
    return [Markup.button.callback(clampButtonLabel(`${st(status).e} ${name}`), `h:pick:${series}:${recordIndex}:${memberIndex}`)];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `h:session:${series}:${recordIndex}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'h:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `h:session:${series}:${recordIndex}:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([Markup.button.callback(TEXT.historyReportButton, `h:report:${series}:${recordIndex}`)]);
  rows.push([
    Markup.button.callback(TEXT.historyBackToSessionsButton, `h:edit:${series}:0`),
    Markup.button.callback(TEXT.historyBackToHomeButton, `h:home:${series}`),
  ]);

  return { names, safePage, totalPages, keyboard: Markup.inlineKeyboard(rows) };
}

export function register(bot, storage) {
  const { getAllSessions, getSessions, saveSessions, getMaster } = storage;

  bot.action(/^h:home:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    await ctx.editMessageText(TEXT.historyHomeText(series, scoped.length), {
      parse_mode: 'Markdown',
      ...historyHomeKb(series),
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action(/^h:rep:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    const report = `${TEXT.recordsHeader(series, scoped.length)}\n\n${buildClassHistoryReport(scoped)}`;
    await replyChunked(ctx, report);
    await ctx.answerCbQuery(TEXT.historyReportSent);
  });

  bot.action(/^h:report:(\d+):(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const recordIndex = parseInt(ctx.match[2], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const master = await getMaster(groupId);
    await sendSessionReport(ctx, picked, master);
    await ctx.answerCbQuery(TEXT.reportGenerated);
  });

  bot.action(/^h:edit:(\d+):(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const requestedPage = parseInt(ctx.match[2], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    const { safePage, totalPages, keyboard } = editSessionKb(scoped, series, Number.isInteger(requestedPage) ? requestedPage : 0);
    await ctx.editMessageText(editSessionsText(series, scoped.length, safePage, totalPages), {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action(/^h:session:(\d+):(\d+):(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const recordIndex = parseInt(ctx.match[2], 10);
    const requestedPage = parseInt(ctx.match[3], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const { names, safePage, totalPages, keyboard } = sessionEditorKb(
      series,
      recordIndex,
      picked,
      Number.isInteger(requestedPage) ? requestedPage : 0
    );
    await ctx.editMessageText(
      sessionEditorText(recordIndex, picked, names, safePage, totalPages),
      { parse_mode: 'Markdown', ...keyboard }
    );
    await ctx.answerCbQuery(TEXT.refreshed);
  });

  bot.action(/^h:pick:(\d+):(\d+):(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const recordIndex = parseInt(ctx.match[2], 10);
    const memberIndex = parseInt(ctx.match[3], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const names = sortArabic(Object.keys(picked.attendance || {}));
    const name = names[memberIndex];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);
    const status = picked.attendance?.[name] || null;
    const memberPage = Math.max(0, Math.floor(memberIndex / 8));

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(TEXT.historyStatusButtons.present, `h:set:${series}:${recordIndex}:${memberIndex}:present`),
        Markup.button.callback(TEXT.historyStatusButtons.listening, `h:set:${series}:${recordIndex}:${memberIndex}:listening`),
      ],
      [
        Markup.button.callback(TEXT.historyStatusButtons.excused, `h:set:${series}:${recordIndex}:${memberIndex}:excused`),
        Markup.button.callback(TEXT.historyStatusButtons.absent, `h:set:${series}:${recordIndex}:${memberIndex}:absent`),
      ],
      [Markup.button.callback(TEXT.historyStatusButtons.pending, `h:set:${series}:${recordIndex}:${memberIndex}:pending`)],
      [Markup.button.callback(TEXT.backButton, `h:session:${series}:${recordIndex}:${memberPage}`)],
    ]);

    await ctx.editMessageText(
      TEXT.historyEditMemberStatusText(name, st(status).a),
      { parse_mode: 'Markdown', ...kb }
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^h:set:(\d+):(\d+):(\d+):(present|listening|excused|absent|pending)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const series = parseInt(ctx.match[1], 10);
    const recordIndex = parseInt(ctx.match[2], 10);
    const memberIndex = parseInt(ctx.match[3], 10);
    const status = ctx.match[4];

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const names = sortArabic(Object.keys(picked.attendance || {}));
    const name = names[memberIndex];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const typeSessions = await getSessions(groupId, picked.type);
    const targetKey = archivedSessionKey(picked);
    const targetIndex = typeSessions.findIndex((s) => archivedSessionKey(s) === targetKey);
    if (targetIndex === -1) return ctx.answerCbQuery(TEXT.recordNotFoundForEdit);

    if (!typeSessions[targetIndex].attendance || typeof typeSessions[targetIndex].attendance !== 'object') {
      typeSessions[targetIndex].attendance = {};
    }
    typeSessions[targetIndex].attendance[name] = status === 'pending' ? null : status;
    await saveSessions(groupId, picked.type, typeSessions);

    const page = Math.max(0, Math.floor(memberIndex / 8));
    const refreshedAll = await getAllSessions(groupId);
    const refreshedScoped = sessionsInSeries(refreshedAll, series);
    const refreshedPicked = refreshedScoped[recordIndex - 1];
    if (!refreshedPicked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const { names: refreshedNames, safePage, totalPages, keyboard } = sessionEditorKb(series, recordIndex, refreshedPicked, page);
    await ctx.editMessageText(
      sessionEditorText(recordIndex, refreshedPicked, refreshedNames, safePage, totalPages),
      { parse_mode: 'Markdown', ...keyboard }
    );
    await ctx.answerCbQuery(TEXT.historyStatusUpdated(name, st(status === 'pending' ? null : status).a));
  });

  bot.action('h:noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
}

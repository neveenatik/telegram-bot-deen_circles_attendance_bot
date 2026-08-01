import { Markup } from 'telegraf';
import { isAdminOf } from '../../guards.js';
import { sortArabic, replyChunked, beginForceReplyAwaiting } from '../../helpers.js';
import { TEXT, st } from '../../text.js';
import { sessionsInSeries, archivedSessionKey, clampButtonLabel } from '../../historyUtils.js';
import { sendSessionReport } from '../commands/stop.js';
import * as participants from '../../sessionParticipants.js';
import { SESSION_TYPES, isActiveSessionType } from '../../sessionTypes.js';

// The editor groups sessions by type in the canonical order and addresses each
// type via a colon-free callback token: a known type key verbatim, or `other`
// for anything outside SESSION_TYPES.
function typeKeyOf(session) {
  return isActiveSessionType(session.type) ? session.type : 'other';
}

// Sessions of a given type key, each tagged with its 1-based position within the
// full series list so downstream handlers keep addressing by absolute record
// index (scoped[recordIndex - 1]).
function sessionsOfType(scoped, typeKey) {
  return scoped
    .map((session, i) => ({ session, absoluteIndex: i + 1 }))
    .filter(({ session }) => typeKeyOf(session) === typeKey);
}

// The archived-session editor orders names alphabetically by default. Callers
// (e.g. offline classes) can override the order via `nav.order(session)` so the
// SAME order is used both to render buttons and to resolve positional tokens.
function orderedNamesFor(session, nav) {
  return nav && typeof nav.order === 'function'
    ? nav.order(session)
    : sortArabic(participants.names(session));
}

// The shared resolver in sessionParticipants maps a token (member `u<id>` / guest
// or offline `g<i>` / legacy bare index) back to `{ name, index }` within the
// widget's order.
function resolveHistoryTarget(session, token, nav) {
  return participants.resolveToken(session, orderedNamesFor(session, nav), token);
}

export function historyHomeKb(groupId, series, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  return Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.historyShowReportButton, `${ns}:rep:${gref}:${series}`)],
    [Markup.button.callback(TEXT.historyEditSessionsButton, `${ns}:edit:${gref}:${series}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ]);
}

function buildClassHistoryReport(scoped, tz = 'Africa/Cairo') {
  const indexed = scoped.map((s, i) => ({ session: s, index: i + 1 }));
  const typeTitle = {
    main: TEXT.historyTypeTitle.main,
    training: TEXT.historyTypeTitle.training,
    open: TEXT.historyTypeTitle.open,
    registeredSecondary: TEXT.historyTypeTitle.registeredSecondary,
    personalRecitation: TEXT.historyTypeTitle.personalRecitation,
    groupRecitation: TEXT.historyTypeTitle.groupRecitation,
    other: TEXT.historyTypeTitle.other,
  };

  const sections = [];
  for (const type of SESSION_TYPES) {
    const rows = indexed.filter(({ session }) => session.type === type);
    if (!rows.length) continue;
    const lines = rows.map(({ session, index }) => TEXT.recordsLine(index, session, tz));
    sections.push(`${typeTitle[type]} (${rows.length})\n${lines.join('\n')}`);
  }

  const otherRows = indexed.filter(({ session }) => !isActiveSessionType(session.type));
  if (otherRows.length) {
    const lines = otherRows.map(({ session, index }) => TEXT.recordsLine(index, session, tz));
    sections.push(`${typeTitle.other} (${otherRows.length})\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function editSessionsText(series, count, page, totalPages) {
  return TEXT.historyEditSessionsText(series, count, page + 1, totalPages);
}

// Type picker: one button per session type present in the series (with its
// count), so the admin narrows down before the session list is rendered.
function editTypeMenuKb(scoped, groupId, series, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  const rows = [];
  for (const type of SESSION_TYPES) {
    const count = scoped.filter((s) => s.type === type).length;
    if (!count) continue;
    rows.push([Markup.button.callback(
      clampButtonLabel(`${TEXT.historyTypeTitle[type]} (${count})`),
      `${ns}:etype:${gref}:${series}:${type}:0`
    )]);
  }
  const otherCount = scoped.filter((s) => !isActiveSessionType(s.type)).length;
  if (otherCount) {
    rows.push([Markup.button.callback(
      clampButtonLabel(`${TEXT.historyTypeTitle.other} (${otherCount})`),
      `${ns}:etype:${gref}:${series}:other:0`
    )]);
  }
  rows.push([
    Markup.button.callback(TEXT.backButton, `${ns}:home:${gref}:${series}`),
    Markup.button.callback(TEXT.closeButton, 'msg:dismiss'),
  ]);
  return Markup.inlineKeyboard(rows);
}

function editSessionKb(scoped, groupId, series, typeKey, page = 0, pageSize = 8, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  const tz = nav.tz || 'Africa/Cairo';
  const entries = sessionsOfType(scoped, typeKey);
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const rows = entries.slice(start, start + pageSize).map(({ session: s, absoluteIndex }) => {
    const date = new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: tz });
    const label = clampButtonLabel(`${absoluteIndex}. ${s.name} | ${date}`);
    return [Markup.button.callback(label, `${ns}:session:${gref}:${series}:${absoluteIndex}:0`)];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `${ns}:etype:${gref}:${series}:${typeKey}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, `${ns}:noop`),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `${ns}:etype:${gref}:${series}:${typeKey}:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([
    Markup.button.callback(TEXT.backButton, `${ns}:edit:${gref}:${series}`),
    Markup.button.callback(TEXT.closeButton, 'msg:dismiss'),
  ]);

  return { safePage, totalPages, count: entries.length, keyboard: Markup.inlineKeyboard(rows) };
}

function sessionEditorText(recordIndex, session, names, page, totalPages, tz = 'Africa/Cairo') {
  const date = new Date(session.endedAt || session.startedAt).toLocaleDateString('ar-EG', { timeZone: tz });
  const head = [TEXT.historySessionEditorHeader(recordIndex), `${session.name} | ${date}`, `📄 صفحة ${page + 1}/${totalPages}`, ''];
  const start = page * 8;
  const body = names.slice(start, start + 8).map((name, i) => {
    const status = participants.getStatus(session, name);
    // Prefer the stable roster number over the volatile position on the page so
    // the editor matches the roster/report numbering (falls back for guests).
    const listNumber = participants.getListNumber(session, name);
    const num = listNumber != null ? listNumber : start + i + 1;
    return `${num}. ${st(status).e} ${name}`;
  });
  return [...head, ...(body.length ? body : [TEXT.historySessionEditorEmpty])].join('\n');
}

function sessionEditorKb(groupId, series, recordIndex, session, page = 0, pageSize = 8, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  const names = orderedNamesFor(session, nav);
  const totalPages = Math.max(1, Math.ceil(names.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;

  const rows = names.slice(start, start + pageSize).map((name, i) => {
    const token = participants.memberToken(session, name, start + i);
    const status = participants.getStatus(session, name);
    return [Markup.button.callback(clampButtonLabel(`${st(status).e} ${name}`), `${ns}:pick:${gref}:${series}:${recordIndex}:${token}`)];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `${ns}:session:${gref}:${series}:${recordIndex}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, `${ns}:noop`),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `${ns}:session:${gref}:${series}:${recordIndex}:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([
    Markup.button.callback(TEXT.historyReportButton, `${ns}:report:${gref}:${series}:${recordIndex}`),
    Markup.button.callback(TEXT.historyEditTitleButton, `${ns}:etitle:${gref}:${series}:${recordIndex}:${safePage}`),
  ]);
  // Recitation-correction sessions record a verse per student. Verses only make
  // sense for students who actually attended, so they get a dedicated present-only
  // browsing view instead of cluttering the per-member (all students) status menu.
  if (session.type === 'registeredSecondary') {
    rows.push([Markup.button.callback(TEXT.historyEditVersesButton, `${ns}:vlist:${gref}:${series}:${recordIndex}:0`)]);
  }
  // Deleting a whole session is destructive, so it lives behind a confirm step.
  // Live history admins always see it; offline delegates only when their role
  // allows it (nav.caps.deleteSession — undefined in live mode means allowed).
  if (!nav.caps || nav.caps.deleteSession !== false) {
    rows.push([Markup.button.callback(TEXT.historyDeleteSessionButton, `${ns}:sdel:${gref}:${series}:${recordIndex}:${safePage}`)]);
  }
  // Back targets default to the shared history panels, but callers can redirect
  // them (offline classes send you back to their own session menu / class home).
  const backToSessions = typeof nav.backToSessions === 'function'
    ? nav.backToSessions(recordIndex, session)
    : `${ns}:etype:${gref}:${series}:${typeKeyOf(session)}:0`;
  const backToHome = typeof nav.backToHome === 'function'
    ? nav.backToHome()
    : `${ns}:home:${gref}:${series}`;
  rows.push([
    Markup.button.callback(TEXT.historyBackToSessionsButton, backToSessions),
    Markup.button.callback(TEXT.historyBackToHomeButton, backToHome),
  ]);

  return { names, safePage, totalPages, keyboard: Markup.inlineKeyboard(rows) };
}

// Renders the archived-session editor (member list + actions) in one place so
// the `session`/`setStatus` actions and the title-edit reply handler (text.js)
// all refresh the exact same panel.
export function renderHistorySessionEditor(groupId, series, recordIndex, session, page = 0, nav = { ns: 'h', gref: groupId }) {
  const { names, safePage, totalPages, keyboard } = sessionEditorKb(groupId, series, recordIndex, session, page, 8, nav);
  return {
    text: sessionEditorText(recordIndex, session, names, safePage, totalPages, nav.tz || 'Africa/Cairo'),
    keyboard,
    safePage,
    totalPages,
  };
}

// Per-member editor panel (opened from a name in the session editor). It edits
// attendance status for every session type. Verse editing lives in its own
// present-only view (renderHistoryVerseList), so this menu stays status-only.
export function renderHistoryMemberMenu(groupId, series, recordIndex, session, token, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  const target = resolveHistoryTarget(session, token, nav);
  if (!target) return null;
  const { name, index } = target;
  const memberPage = Math.max(0, Math.floor(index / 8));

  const lines = [TEXT.historyEditMemberStatusText(name, st(participants.getStatus(session, name)).a)];

  const setCb = (status) => `${ns}:set:${gref}:${series}:${recordIndex}:${token}:${status}`;
  const rows = [
    [
      Markup.button.callback(TEXT.historyStatusButtons.present, setCb('present')),
      Markup.button.callback(TEXT.historyStatusButtons.listening, setCb('listening')),
    ],
    [
      Markup.button.callback(TEXT.historyStatusButtons.excused, setCb('excused')),
      Markup.button.callback(TEXT.historyStatusButtons.absent, setCb('absent')),
    ],
    [Markup.button.callback(TEXT.historyStatusButtons.pending, setCb('pending'))],
  ];

  // Recitation-correction sessions also record whether the student attested to
  // attending the main halaqa (attendedMain) and whether she was on the reserve
  // list (backup). Expose both as toggle rows so the admin can fix them after the
  // fact; a 🔘 marks the currently-active choice.
  if (session.type === 'registeredSecondary') {
    const attendedMain = participants.getAttendedMain(session, name);
    const backup = participants.getBackup(session, name) === true;
    const mark = (active) => (active ? '🔘 ' : '');
    const flagCb = (flag, value) => `${ns}:rflag:${gref}:${series}:${recordIndex}:${token}:${flag}:${value}`;

    const mainLabel = attendedMain === true
      ? TEXT.historyReciteMainButtons.attended
      : attendedMain === false
        ? TEXT.historyReciteMainButtons.notAttended
        : TEXT.historyReciteMainUnset;
    const backupLabel = backup ? TEXT.historyReciteBackupButtons.on : TEXT.historyReciteBackupButtons.off;
    lines.push(TEXT.historyReciteFlagsText(mainLabel, backupLabel));

    rows.push([
      Markup.button.callback(mark(attendedMain === true) + TEXT.historyReciteMainButtons.attended, flagCb('main', 1)),
      Markup.button.callback(mark(attendedMain === false) + TEXT.historyReciteMainButtons.notAttended, flagCb('main', 0)),
    ]);
    rows.push([
      Markup.button.callback(mark(backup) + TEXT.historyReciteBackupButtons.on, flagCb('backup', 1)),
      Markup.button.callback(mark(!backup) + TEXT.historyReciteBackupButtons.off, flagCb('backup', 0)),
    ]);
  }

  rows.push([Markup.button.callback(TEXT.backButton, `${ns}:session:${gref}:${series}:${recordIndex}:${memberPage}`)]);

  return { name, index, text: lines.join('\n\n'), keyboard: Markup.inlineKeyboard(rows) };
}

// Present-only verse browser for recitation-correction sessions. Lists just the
// students who attended (present/listening) so the admin can jump straight into
// editing each recited verse without wading through the full roster. Guest
// tokens use the index within the FULL sorted list so resolveHistoryTarget maps
// them back correctly.
export function renderHistoryVerseList(groupId, series, recordIndex, session, page = 0, pageSize = 8, nav = { ns: 'h', gref: groupId }) {
  const { ns, gref } = nav;
  const allNames = orderedNamesFor(session, nav);
  const present = allNames
    .map((name, fullIndex) => ({ name, fullIndex, status: participants.getStatus(session, name) }))
    .filter(({ status }) => status === 'present' || status === 'listening');

  const totalPages = Math.max(1, Math.ceil(present.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const slice = present.slice(start, start + pageSize);

  const head = [TEXT.historyVerseListHeader(recordIndex), TEXT.historyVerseListHint, `📄 صفحة ${safePage + 1}/${totalPages}`, ''];
  const body = slice.length
    ? slice.map(({ name, status }, i) => `${start + i + 1}. ${st(status).e} ${name} — ${participants.getVerse(session, name) || '—'}`)
    : [TEXT.historyVerseListEmpty];
  const text = [...head, ...body].join('\n');

  const rows = slice.map(({ name, fullIndex, status }) => {
    const token = participants.memberToken(session, name, fullIndex);
    const label = clampButtonLabel(`${st(status).e} ${name} | ${participants.getVerse(session, name) || '—'}`);
    return [Markup.button.callback(label, `${ns}:everse:${gref}:${series}:${recordIndex}:${token}:v${safePage}`)];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `${ns}:vlist:${gref}:${series}:${recordIndex}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, `${ns}:noop`),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `${ns}:vlist:${gref}:${series}:${recordIndex}:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([
    Markup.button.callback(TEXT.backButton, `${ns}:session:${gref}:${series}:${recordIndex}:0`),
    Markup.button.callback(TEXT.closeButton, 'msg:dismiss'),
  ]);

  return { text, keyboard: Markup.inlineKeyboard(rows), safePage, totalPages, count: present.length };
}

export function createHandlers({ storage, telegram, ns = 'h', resolveContext, orderNames, backBuilders } = {}) {
  const { getAllSessions, getSessions, saveSessions, deleteSession, getSessionParticipants, getMaster, setReplyPrompt, getPendingRegistrations, getSessionTeacher, getClassTimezone } = storage;

  // Reports/date labels render in the class's configured timezone
  // (group_settings.timezone), falling back to Cairo when unavailable.
  async function classTz(groupId) {
    if (!getClassTimezone) return 'Africa/Cairo';
    try { return await getClassTimezone(groupId); } catch { return 'Africa/Cairo'; }
  }

  // Credit the teacher explicitly assigned to a session (the "assign teacher"
  // feature) on its report. No type-based guessing.
  async function resolveSessionTeacherName(session) {
    if (!getSessionTeacher || !session?.id) return null;
    try {
      const assigned = await getSessionTeacher(session.id);
      return assigned?.name || null;
    } catch {
      return null;
    }
  }

  // Access + addressing are pluggable so the same editing logic serves the live
  // history panel (`h:` namespace, group-admin gate, group id = callback token)
  // and offline classes (`o:` namespace, owner gate, numeric groups.id token
  // resolved back to the real storage key). resolveContext(ctx) returns
  // `{ ok, groupId, gref, reason? }`: `groupId` is the real storage key used with
  // every storage method, `gref` is the compact token echoed back into callbacks.
  const resolve = resolveContext || (async (ctx) => {
    const groupId = ctx.match[1];
    const ok = await isAdminOf(telegram, groupId, ctx.from.id);
    return { ok, groupId, gref: groupId };
  });
  const nav = (gref) => ({ ns, gref, order: orderNames, ...(backBuilders ? backBuilders(gref) : {}) });

  // getAllSessions returns metadata-only records (no participants) to keep the
  // panel fast and dodge the 1000-row cap. Fill in a picked record's roster on
  // demand before any view that renders participant names/statuses.
  async function hydrate(groupId, session) {
    if (!session) return session;
    const map = await getSessionParticipants(groupId, [session.id]);
    session.participants = map[session.id] || {};
    return session;
  }

  async function home(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    await ctx.editMessageText(TEXT.historyHomeText(series, scoped.length), {
      parse_mode: 'Markdown',
      ...historyHomeKb(groupId, series, nav(gref)),
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  async function seriesReport(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId } = rc;
    const series = parseInt(ctx.match[2], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    const report = `${TEXT.recordsHeader(series, scoped.length)}\n\n${buildClassHistoryReport(scoped, await classTz(groupId))}`;
    await replyChunked(ctx, report);
    await ctx.answerCbQuery(TEXT.historyReportSent);
  }

  async function sessionReport(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, picked);
    const master = await getMaster(groupId);
    const pending = getPendingRegistrations ? await getPendingRegistrations(groupId) : [];
    const teacherName = await resolveSessionTeacherName(picked);
    await sendSessionReport(ctx, picked, master, pending, { teacherName });
    await ctx.answerCbQuery(TEXT.reportGenerated);
  }

  async function edit(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    await ctx.editMessageText(TEXT.historyEditTypesText(series, scoped.length), {
      parse_mode: 'Markdown',
      ...editTypeMenuKb(scoped, groupId, series, nav(gref)),
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  async function editType(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const typeKey = ctx.match[3];
    const requestedPage = parseInt(ctx.match[4], 10);
    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    const { safePage, totalPages, count, keyboard } = editSessionKb(
      scoped,
      groupId,
      series,
      typeKey,
      Number.isInteger(requestedPage) ? requestedPage : 0,
      8,
      { ...nav(gref), tz: await classTz(groupId) }
    );
    if (!count) return ctx.answerCbQuery(TEXT.noSeriesRecords(series));

    await ctx.editMessageText(editSessionsText(series, count, safePage, totalPages), {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  async function session(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const requestedPage = parseInt(ctx.match[4], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, picked);
    const editor = renderHistorySessionEditor(
      groupId,
      series,
      recordIndex,
      picked,
      Number.isInteger(requestedPage) ? requestedPage : 0,
      { ...nav(gref), caps: rc.caps, tz: await classTz(groupId) }
    );
    await ctx.editMessageText(editor.text, { parse_mode: 'Markdown', ...editor.keyboard });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  // Destructive: confirm before wiping a whole archived session. Gated for
  // offline delegates via rc.caps (live-history admins have no caps => allowed).
  async function deleteSessionPrompt(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    if (rc.caps && rc.caps.deleteSession === false) return ctx.answerCbQuery(TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const page = parseInt(ctx.match[4], 10) || 0;

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.historyConfirmDeleteSessionButton, `${ns}:sdelx:${gref}:${series}:${recordIndex}`)],
      [Markup.button.callback(TEXT.cancelButton, `${ns}:session:${gref}:${series}:${recordIndex}:${page}`)],
    ]);
    await ctx.editMessageText(TEXT.historyDeleteSessionConfirmText(picked.name), { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
  }

  async function deleteSessionConfirm(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    if (rc.caps && rc.caps.deleteSession === false) return ctx.answerCbQuery(TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await deleteSession(groupId, picked.id);

    // The record indices shift after a delete, so return to the (rebuilt) type
    // menu rather than a now-stale session editor.
    const refreshedAll = await getAllSessions(groupId);
    const refreshedScoped = sessionsInSeries(refreshedAll, series);
    await ctx.editMessageText(TEXT.historyEditTypesText(series, refreshedScoped.length), {
      parse_mode: 'Markdown',
      ...editTypeMenuKb(refreshedScoped, groupId, series, nav(gref)),
    });
    await ctx.answerCbQuery(TEXT.historySessionDeleted(picked.name));
  }

  async function pick(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const token = ctx.match[4];

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, picked);
    const menu = renderHistoryMemberMenu(groupId, series, recordIndex, picked, token, nav(gref));
    if (!menu) return ctx.answerCbQuery(TEXT.memberNotFound);

    await ctx.editMessageText(menu.text, { parse_mode: 'Markdown', ...menu.keyboard });
    await ctx.answerCbQuery();
  }

  // Present-only verse browser for recitation sessions: lists just the students
  // who attended so verse corrections don't require scanning the whole roster.
  async function verseList(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const requestedPage = parseInt(ctx.match[4], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);
    if (picked.type !== 'registeredSecondary') return ctx.answerCbQuery(TEXT.memberNotFound);

    await hydrate(groupId, picked);
    const view = renderHistoryVerseList(
      groupId,
      series,
      recordIndex,
      picked,
      Number.isInteger(requestedPage) ? requestedPage : 0,
      8,
      nav(gref)
    );
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(TEXT.refreshed);
  }

  // Recitation-correction sessions record a recited verse per member. Editing it
  // needs free-form text, so we capture the reply via the shared force-reply
  // awaiting flow (resolved in text.js → historyEditVerse). Launched from the
  // present-only verse list; the trailing `:v<page>` keeps the refresh on that page.
  async function editVerse(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const token = ctx.match[4];
    const listPage = parseInt(ctx.match[5], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);
    if (picked.type !== 'registeredSecondary') return ctx.answerCbQuery(TEXT.memberNotFound);

    await hydrate(groupId, picked);
    const target = resolveHistoryTarget(picked, token, nav(gref));
    if (!target) return ctx.answerCbQuery(TEXT.memberNotFound);
    const { name } = target;

    return beginForceReplyAwaiting(ctx, {
      setReplyPrompt, groupId,
      record: {
        action: 'historyEditVerse', ns, gref,
        series, recordIndex, recordKey: archivedSessionKey(picked), token,
        memberName: name, sessionType: picked.type,
        verseListPage: Number.isInteger(listPage) ? listPage : 0,
      },
      sendPrompt: () => ctx.reply(TEXT.editVersePrompt(name), {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true, input_field_placeholder: 'مثال: 12-18', selective: true },
      }),
    });
  }

  // Editing an archived session's title needs free-form text, captured via the
  // same force-reply awaiting flow (resolved in text.js → historyEditTitle).
  async function editTitle(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const requestedPage = parseInt(ctx.match[4], 10);

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    return beginForceReplyAwaiting(ctx, {
      setReplyPrompt, groupId,
      record: {
        action: 'historyEditTitle', ns, gref,
        series, recordIndex, recordKey: archivedSessionKey(picked), sessionType: picked.type,
        memberPage: Number.isInteger(requestedPage) ? requestedPage : 0,
      },
      sendPrompt: () => ctx.reply(TEXT.historyEditTitlePrompt(picked.name), {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true, input_field_placeholder: 'عنوان الجلسة الجديد', selective: true },
      }),
    });
  }

  async function setStatus(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const token = ctx.match[4];
    const status = ctx.match[5];

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, picked);
    const target = resolveHistoryTarget(picked, token, nav(gref));
    if (!target) return ctx.answerCbQuery(TEXT.memberNotFound);
    const { name, index } = target;

    const typeSessions = await getSessions(groupId, picked.type);
    const targetKey = archivedSessionKey(picked);
    const targetIndex = typeSessions.findIndex((s) => archivedSessionKey(s) === targetKey);
    if (targetIndex === -1) return ctx.answerCbQuery(TEXT.recordNotFoundForEdit);

    participants.setStatus(typeSessions[targetIndex], name, status === 'pending' ? null : status);
    await saveSessions(groupId, picked.type, typeSessions);

    const page = Math.max(0, Math.floor(index / 8));
    const refreshedAll = await getAllSessions(groupId);
    const refreshedScoped = sessionsInSeries(refreshedAll, series);
    const refreshedPicked = refreshedScoped[recordIndex - 1];
    if (!refreshedPicked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, refreshedPicked);
    const editor = renderHistorySessionEditor(groupId, series, recordIndex, refreshedPicked, page, { ...nav(gref), caps: rc.caps, tz: await classTz(groupId) });
    await ctx.editMessageText(editor.text, { parse_mode: 'Markdown', ...editor.keyboard });
    await ctx.answerCbQuery(TEXT.historyStatusUpdated(name, st(status === 'pending' ? null : status).a));
  }

  // Toggle a recitation-correction flag (attendedMain / backup) on an archived
  // participant, then refresh the per-member menu in place so the 🔘 marker
  // flips. Only valid for registeredSecondary sessions.
  async function setReciteFlag(ctx) {
    const rc = await resolve(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason || TEXT.adminOnly);
    const { groupId, gref } = rc;
    const series = parseInt(ctx.match[2], 10);
    const recordIndex = parseInt(ctx.match[3], 10);
    const token = ctx.match[4];
    const flag = ctx.match[5];
    const value = ctx.match[6] === '1';

    const all = await getAllSessions(groupId);
    const scoped = sessionsInSeries(all, series);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);
    if (picked.type !== 'registeredSecondary') return ctx.answerCbQuery(TEXT.memberNotFound);

    await hydrate(groupId, picked);
    const target = resolveHistoryTarget(picked, token, nav(gref));
    if (!target) return ctx.answerCbQuery(TEXT.memberNotFound);
    const { name } = target;

    const typeSessions = await getSessions(groupId, picked.type);
    const targetKey = archivedSessionKey(picked);
    const targetIndex = typeSessions.findIndex((s) => archivedSessionKey(s) === targetKey);
    if (targetIndex === -1) return ctx.answerCbQuery(TEXT.recordNotFoundForEdit);

    if (flag === 'main') participants.setAttendedMain(typeSessions[targetIndex], name, value);
    else participants.setBackup(typeSessions[targetIndex], name, value);
    await saveSessions(groupId, picked.type, typeSessions);

    const refreshedAll = await getAllSessions(groupId);
    const refreshedScoped = sessionsInSeries(refreshedAll, series);
    const refreshedPicked = refreshedScoped[recordIndex - 1];
    if (!refreshedPicked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await hydrate(groupId, refreshedPicked);
    const menu = renderHistoryMemberMenu(groupId, series, recordIndex, refreshedPicked, token, nav(gref));
    if (!menu) return ctx.answerCbQuery(TEXT.memberNotFound);
    await ctx.editMessageText(menu.text, { parse_mode: 'Markdown', ...menu.keyboard });

    const label = flag === 'main'
      ? (value ? TEXT.historyReciteMainButtons.attended : TEXT.historyReciteMainButtons.notAttended)
      : (value ? TEXT.historyReciteBackupButtons.on : TEXT.historyReciteBackupButtons.off);
    await ctx.answerCbQuery(TEXT.historyStatusUpdated(name, label));
  }

  async function noop(ctx) {
    await ctx.answerCbQuery();
  }

  return { home, seriesReport, sessionReport, edit, editType, session, pick, verseList, editVerse, editTitle, setStatus, setReciteFlag, deleteSessionPrompt, deleteSessionConfirm, noop };
}

// Wire the shared editor handlers under a namespace prefix. `gref` is numeric in
// both modes (live: group chat id, may be negative; offline: groups.id), so the
// same `(-?\d+)` group-ref pattern serves both.
export function registerEditorRoutes(bot, h, ns) {
  bot.action(new RegExp(`^${ns}:home:(-?\\d+):(\\d+)$`), h.home);
  bot.action(new RegExp(`^${ns}:rep:(-?\\d+):(\\d+)$`), h.seriesReport);
  bot.action(new RegExp(`^${ns}:report:(-?\\d+):(\\d+):(\\d+)$`), h.sessionReport);
  bot.action(new RegExp(`^${ns}:edit:(-?\\d+):(\\d+)$`), h.edit);
  bot.action(new RegExp(`^${ns}:etype:(-?\\d+):(\\d+):([a-zA-Z]+):(\\d+)$`), h.editType);
  bot.action(new RegExp(`^${ns}:session:(-?\\d+):(\\d+):(\\d+):(\\d+)$`), h.session);
  bot.action(new RegExp(`^${ns}:pick:(-?\\d+):(\\d+):(\\d+):([ug]?\\d+)$`), h.pick);
  bot.action(new RegExp(`^${ns}:vlist:(-?\\d+):(\\d+):(\\d+):(\\d+)$`), h.verseList);
  bot.action(new RegExp(`^${ns}:everse:(-?\\d+):(\\d+):(\\d+):([ug]?\\d+):v(\\d+)$`), h.editVerse);
  bot.action(new RegExp(`^${ns}:etitle:(-?\\d+):(\\d+):(\\d+):(\\d+)$`), h.editTitle);
  bot.action(new RegExp(`^${ns}:set:(-?\\d+):(\\d+):(\\d+):([ug]?\\d+):(present|listening|excused|absent|pending)$`), h.setStatus);
  bot.action(new RegExp(`^${ns}:rflag:(-?\\d+):(\\d+):(\\d+):([ug]?\\d+):(main|backup):(0|1)$`), h.setReciteFlag);
  bot.action(new RegExp(`^${ns}:sdel:(-?\\d+):(\\d+):(\\d+):(\\d+)$`), h.deleteSessionPrompt);
  bot.action(new RegExp(`^${ns}:sdelx:(-?\\d+):(\\d+):(\\d+)$`), h.deleteSessionConfirm);
  bot.action(`${ns}:noop`, h.noop);
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  registerEditorRoutes(bot, h, 'h');
}

// Wire the shared session editor under the offline `o:` namespace with a caller-
// supplied `resolveContext` (resolves numeric groups.id -> real offline group +
// owner gate). Returns the built handler set so callers can reuse renderers.
export function registerOfflineEditor(bot, storage, resolveContext, options = {}) {
  const h = createHandlers({ storage, telegram: bot.telegram, ns: 'o', resolveContext, ...options });
  registerEditorRoutes(bot, h, 'o');
  return h;
}
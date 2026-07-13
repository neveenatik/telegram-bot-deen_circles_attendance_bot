// Offline (DM-only) class attendance.
//
// A teacher can manage her own classes privately, with the bot NOT in any group
// and students never interacting with it. Each class is a synthetic `groups`
// row owned by one user (see storage.createOfflineClass). Class-level panels
// (`o:cls|roster|teach|slist|...`) live here; the per-session attendance editor
// is the SAME shared editor used by the live history panel, wired under the
// `o:` namespace via registerOfflineEditor with an owner-gated resolveContext.
//
// Callback tokens use the numeric `groups.id` (gref) — compact and colon-free —
// which every handler resolves back to the real storage key + owner on each tap.
import { Markup } from 'telegraf';
import { TEXT } from '../../text.js';
import {
  sortArabic,
  beginForceReplyAwaiting,
  replyEphemeral,
} from '../../helpers.js';
import { sessionsInSeries, archivedSessionKey, clampButtonLabel } from '../../historyUtils.js';
import { registerOfflineEditor } from './history.js';

const OT = TEXT.offline;
const OFFLINE_SESSION_TYPES = ['main', 'registeredSecondary', 'training'];
const TEACHER_TYPES = ['courseteacher', 'trainingteacher', 'recitationteacher'];
const ROSTER_PAGE_SIZE = 10;
const SESSIONS_PAGE_SIZE = 8;

function dismissRow() {
  return [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')];
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
}

// ── Pure renderers (shared with text.js for post-reply refresh) ──────────────

export function renderClassList(classes) {
  const list = Array.isArray(classes) ? classes : [];
  const rows = list.map((c) => [
    Markup.button.callback(clampButtonLabel(c.name || '—'), `o:cls:${c.rowId}`),
  ]);
  rows.push([Markup.button.callback(OT.newClassButton, 'o:new')]);
  rows.push(dismissRow());
  const text = list.length ? OT.myClassesTitle : `${OT.myClassesTitle}\n\n${OT.noClasses}`;
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

export function renderClassHome(cls) {
  const g = cls.rowId;
  const rows = [
    [Markup.button.callback(OT.rosterButton, `o:roster:${g}:0`)],
    [Markup.button.callback(OT.sessionsButton, `o:slist:${g}:0`)],
    [Markup.button.callback(OT.newSessionButton, `o:newsess:${g}`)],
    [Markup.button.callback(OT.teachersButton, `o:teach:${g}`)],
    [Markup.button.callback(OT.reportButton, `o:rep:${g}:1`)],
    [Markup.button.callback(OT.renameClassButton, `o:crename:${g}`)],
    [Markup.button.callback(TEXT.backButton, 'o:mine'), ...dismissRow()],
  ];
  return { text: OT.classHome(cls.name), keyboard: Markup.inlineKeyboard(rows) };
}

export function renderRoster(cls, members, page = 0) {
  const g = cls.rowId;
  const names = sortArabic((members || []).map((m) => m.name));
  const totalPages = Math.max(1, Math.ceil(names.length / ROSTER_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ROSTER_PAGE_SIZE;
  const slice = names.slice(start, start + ROSTER_PAGE_SIZE);
  const body = names.length
    ? slice.map((name, i) => `${start + i + 1}. ${name}`).join('\n')
    : OT.rosterEmpty;

  const rows = [[Markup.button.callback(OT.addStudentsButton, `o:addstu:${g}`)]];
  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `o:roster:${g}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'o:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `o:roster:${g}:${safePage + 1}`)] : []),
    ]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  return { text: `${OT.rosterTitle(cls.name, names.length)}\n\n${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

export function renderTeachers(cls, teachers) {
  const g = cls.rowId;
  const list = Array.isArray(teachers) ? teachers : [];
  let body = OT.teachersEmpty;
  if (list.length) {
    body = TEACHER_TYPES
      .map((type) => {
        const group = list.filter((t) => t.type === type);
        if (!group.length) return null;
        const label = TEXT.teacherTypeLabel[type] || type;
        return `${label}:\n${group.map((t) => `• ${t.name}`).join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }
  const rows = [
    [Markup.button.callback(OT.addTeacherButton, `o:addteach:${g}`)],
    [Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()],
  ];
  return { text: `${OT.teachersTitle}\n\n${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

function renderNewSessionMenu(cls) {
  const g = cls.rowId;
  const rows = OFFLINE_SESSION_TYPES.map((type) => [
    Markup.button.callback(TEXT.historyTypeTitle[type] || type, `o:mksess:${g}:${type}`),
  ]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  return { text: OT.newSessionTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function renderSessionsList(cls, scoped, page = 0) {
  const g = cls.rowId;
  const totalPages = Math.max(1, Math.ceil(scoped.length / SESSIONS_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * SESSIONS_PAGE_SIZE;
  const rows = scoped.slice(start, start + SESSIONS_PAGE_SIZE).map((s, i) => {
    const idx = start + i + 1; // 1-based absolute index within the series
    const label = clampButtonLabel(`${idx}. ${s.name} | ${fmtDate(s.endedAt || s.startedAt)}`);
    return [Markup.button.callback(label, `o:smenu:${g}:1:${idx}`)];
  });
  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `o:slist:${g}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'o:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `o:slist:${g}:${safePage + 1}`)] : []),
    ]);
  }
  rows.push([Markup.button.callback(OT.newSessionButton, `o:newsess:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  const body = scoped.length ? '' : `\n\n${OT.sessionsEmpty}`;
  return { text: `${OT.sessionsListTitle(cls.name)}${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

function renderSessionMenu(cls, recordIndex, session, teacher) {
  const g = cls.rowId;
  const teacherLine = teacher
    ? `\n👩‍🏫 ${TEXT.teacherTypeLabel[teacher.type] || ''} ${teacher.name}`
    : '';
  const text = `🗂️ *${session.name}*\n📅 ${fmtDate(session.endedAt || session.startedAt)}${teacherLine}`;
  const rows = [
    [Markup.button.callback(OT.openEditorButton, `o:session:${g}:1:${recordIndex}:0`)],
    [Markup.button.callback(OT.assignTeacherButton, `o:asgm:${g}:1:${recordIndex}`)],
    [Markup.button.callback(OT.sessionReportButton, `o:report:${g}:1:${recordIndex}`)],
    [Markup.button.callback(TEXT.backButton, `o:slist:${g}:0`), ...dismissRow()],
  ];
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

function renderAssignTeacherMenu(cls, recordIndex, teachers) {
  const g = cls.rowId;
  const list = Array.isArray(teachers) ? teachers : [];
  if (!list.length) {
    return {
      text: OT.noTeachersYet,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.backButton, `o:smenu:${g}:1:${recordIndex}`), ...dismissRow()],
      ]),
    };
  }
  const rows = list.map((t) => [
    Markup.button.callback(
      clampButtonLabel(`${TEXT.teacherTypeLabel[t.type] || ''} ${t.name}`),
      `o:asg:${g}:1:${recordIndex}:${t.id}`
    ),
  ]);
  rows.push([Markup.button.callback(OT.noTeacherButton, `o:asg:${g}:1:${recordIndex}:0`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:smenu:${g}:1:${recordIndex}`), ...dismissRow()]);
  return { text: OT.pickTeacherTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function sessionCreatedKb(gref, recordIndex) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(OT.openEditorButton, `o:session:${gref}:1:${recordIndex}:0`)],
    [Markup.button.callback(OT.assignTeacherButton, `o:asgm:${gref}:1:${recordIndex}`)],
    [Markup.button.callback(TEXT.backButton, `o:cls:${gref}`), ...dismissRow()],
  ]);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export function createHandlers({ storage, telegram }) {
  const {
    listOfflineClasses,
    createOfflineClass,
    getOfflineClassById,
    getMaster,
    getTeachers,
    getSessions,
    saveSessions,
    getAllSessions,
    getSessionTeacher,
    assignSessionTeacher,
    setReplyPrompt,
  } = storage;

  // Resolve numeric gref -> class + owner gate. Shared by every `o:*` handler.
  async function resolveClass(ctx) {
    const cls = await getOfflineClassById(ctx.match[1]);
    if (!cls) return { ok: false, reason: OT.notFound };
    if (String(ctx.from.id) !== cls.ownerUserId) return { ok: false, reason: TEXT.adminOnly };
    return { ok: true, cls };
  }

  // resolveContext for the shared session editor (registerOfflineEditor).
  async function editorResolve(ctx) {
    const cls = await getOfflineClassById(ctx.match[1]);
    if (!cls) return { ok: false, reason: OT.notFound };
    if (String(ctx.from.id) !== cls.ownerUserId) return { ok: false, reason: TEXT.adminOnly };
    return { ok: true, groupId: cls.groupId, gref: cls.rowId };
  }

  // /offline — private entry point. Renders the teacher's own class list.
  async function entry(ctx) {
    if (ctx.chat?.type !== 'private') return replyEphemeral(ctx, OT.chooserTitle);
    const classes = await listOfflineClasses(ctx.from.id);
    const view = renderClassList(classes);
    return ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  }

  async function myClasses(ctx) {
    const classes = await listOfflineClasses(ctx.from.id);
    const view = renderClassList(classes);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function newClassPrompt(ctx) {
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: ctx.from.id,
      record: { action: 'offlineCreateClass' },
      sendPrompt: () => ctx.reply(OT.createPrompt, { reply_markup: { force_reply: true } }),
    });
  }

  async function classHome(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const view = renderClassHome(rc.cls);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function roster(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const page = parseInt(ctx.match[2], 10) || 0;
    const master = await getMaster(rc.cls.groupId);
    const view = renderRoster(rc.cls, master.members, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addStudentsPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineAddStudents', gref: rc.cls.rowId },
      sendPrompt: () => ctx.reply(OT.addStudentsPrompt, { reply_markup: { force_reply: true } }),
    });
  }

  async function renameClassPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineRenameClass', gref: rc.cls.rowId },
      sendPrompt: () => ctx.reply(OT.renamePrompt(rc.cls.name), { reply_markup: { force_reply: true } }),
    });
  }

  async function teachers(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const list = await getTeachers(rc.cls.groupId);
    const view = renderTeachers(rc.cls, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addTeacherPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineAddTeacher', gref: rc.cls.rowId },
      sendPrompt: () => ctx.reply(OT.addTeacherPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function newSessionMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const view = renderNewSessionMenu(rc.cls);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function createSession(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const type = ctx.match[2];
    if (!OFFLINE_SESSION_TYPES.includes(type)) return ctx.answerCbQuery(OT.notFound);
    const gid = rc.cls.groupId;

    const master = await getMaster(gid);
    const startedAt = new Date().toISOString();
    const name = `${TEXT.historyTypeTitle[type] || type} ${fmtDate(startedAt)}`;
    const parts = {};
    for (const m of master.members) {
      parts[m.name] = {
        name: m.name,
        memberId: m.userId != null ? String(m.userId) : null,
        status: null,
        called: null,
        listNumber: m.listNumber ?? undefined,
      };
    }
    const newSession = { name, type, seriesId: 1, active: false, startedAt, endedAt: startedAt, participants: parts };

    const existing = await getSessions(gid, type);
    existing.push(newSession);
    await saveSessions(gid, type, existing);

    const all = await getAllSessions(gid);
    const scoped = sessionsInSeries(all, 1);
    const key = archivedSessionKey(newSession);
    const idx = scoped.findIndex((s) => archivedSessionKey(s) === key);
    const recordIndex = idx >= 0 ? idx + 1 : scoped.length;

    await ctx.editMessageText(OT.sessionCreated(name), {
      parse_mode: 'Markdown',
      ...sessionCreatedKb(rc.cls.rowId, recordIndex),
    });
    await ctx.answerCbQuery();
  }

  async function sessionsList(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const page = parseInt(ctx.match[2], 10) || 0;
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    const view = renderSessionsList(rc.cls, scoped, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function sessionMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const recordIndex = parseInt(ctx.match[3], 10);
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);
    const teacher = await getSessionTeacher(picked.id);
    const view = renderSessionMenu(rc.cls, recordIndex, picked, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacherMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const recordIndex = parseInt(ctx.match[3], 10);
    const list = await getTeachers(rc.cls.groupId);
    const view = renderAssignTeacherMenu(rc.cls, recordIndex, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacher(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const recordIndex = parseInt(ctx.match[3], 10);
    const teacherId = parseInt(ctx.match[4], 10);
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await assignSessionTeacher(rc.cls.groupId, picked.id, teacherId || null);
    const teacher = teacherId ? await getSessionTeacher(picked.id) : null;
    const view = renderSessionMenu(rc.cls, recordIndex, picked, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(teacher ? OT.teacherAssigned(teacher.name) : OT.teacherCleared);
  }

  async function noop(ctx) {
    return ctx.answerCbQuery();
  }

  return {
    entry,
    myClasses,
    newClassPrompt,
    classHome,
    roster,
    addStudentsPrompt,
    renameClassPrompt,
    teachers,
    addTeacherPrompt,
    newSessionMenu,
    createSession,
    sessionsList,
    sessionMenu,
    assignTeacherMenu,
    assignTeacher,
    noop,
    editorResolve,
  };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });

  bot.command('offline', h.entry);

  bot.action('o:mine', h.myClasses);
  bot.action('o:new', h.newClassPrompt);
  bot.action('o:noop', h.noop);
  bot.action(/^o:cls:(\d+)$/, h.classHome);
  bot.action(/^o:roster:(\d+):(\d+)$/, h.roster);
  bot.action(/^o:addstu:(\d+)$/, h.addStudentsPrompt);
  bot.action(/^o:crename:(\d+)$/, h.renameClassPrompt);
  bot.action(/^o:teach:(\d+)$/, h.teachers);
  bot.action(/^o:addteach:(\d+)$/, h.addTeacherPrompt);
  bot.action(/^o:newsess:(\d+)$/, h.newSessionMenu);
  bot.action(/^o:mksess:(\d+):([a-zA-Z]+)$/, h.createSession);
  bot.action(/^o:slist:(\d+):(\d+)$/, h.sessionsList);
  bot.action(/^o:smenu:(\d+):(\d+):(\d+)$/, h.sessionMenu);
  bot.action(/^o:asgm:(\d+):(\d+):(\d+)$/, h.assignTeacherMenu);
  bot.action(/^o:asg:(\d+):(\d+):(\d+):(\d+)$/, h.assignTeacher);

  // The per-session attendance editor is the shared history editor under `o:`.
  registerOfflineEditor(bot, storage, h.editorResolve);
}

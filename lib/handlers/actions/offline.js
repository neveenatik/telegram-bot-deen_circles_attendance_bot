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
  beginForceReplyAwaiting,
  replyEphemeral,
  getDisplayName,
} from '../../helpers.js';
import { sessionsInSeries, archivedSessionKey, clampButtonLabel } from '../../historyUtils.js';
import { registerOfflineEditor } from './history.js';
import * as participants from '../../sessionParticipants.js';

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

// Per-role capability gates. `owner` manages the class outright; delegates are
// authorized per-person (see storage.resolveManageableClass / class_managers):
//   operator  = full operational access EXCEPT renaming the class + managing
//               managers.
//   assistant = attendance editing (shared editor) + reports only.
function capsFor(role) {
  const owner = role === 'owner';
  const operator = role === 'operator';
  return {
    manageClass: owner, // rename class + add/remove managers
    editRoster: owner || operator,
    editTeachers: owner || operator,
    createSession: owner || operator,
    assignTeacher: owner || operator,
    deleteSession: owner || operator, // destructive: not for assistants
    editAttendance: true, // any authorized role (owner/operator/assistant)
    viewReports: true,
  };
}


// ── Pure renderers (shared with text.js for post-reply refresh) ──────────────

export function renderClassList(classes, { back = null } = {}) {
  const list = Array.isArray(classes) ? classes : [];
  const rows = list.map((c) => [
    Markup.button.callback(clampButtonLabel(c.name || '—'), `o:cls:${c.rowId}`),
  ]);
  rows.push([Markup.button.callback(OT.newClassButton, 'o:new')]);
  rows.push(back ? [Markup.button.callback(TEXT.backButton, back), ...dismissRow()] : dismissRow());
  const text = list.length ? OT.myClassesTitle : `${OT.myClassesTitle}\n\n${OT.noClasses}`;
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

// Classes an owner has shared with this user (delegated). No "new class" here —
// only the owner creates classes.
export function renderSharedList(classes, { back = null } = {}) {
  const list = Array.isArray(classes) ? classes : [];
  const rows = list.map((c) => [
    Markup.button.callback(clampButtonLabel(c.name || '—'), `o:cls:${c.rowId}`),
  ]);
  rows.push(back ? [Markup.button.callback(TEXT.backButton, back), ...dismissRow()] : dismissRow());
  const text = list.length ? OT.sharedClassesTitle : `${OT.sharedClassesTitle}\n\n${OT.noSharedClasses}`;
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

// Top-level chooser shown only when the user both owns and is delegated classes;
// otherwise the single non-empty list is shown directly (see entry / root).
export function renderRootChooser() {
  const rows = [
    [Markup.button.callback(OT.myClassesButton, 'o:mine')],
    [Markup.button.callback(OT.sharedClassesButton, 'o:shared')],
    dismissRow(),
  ];
  return { text: OT.rootChooserTitle, keyboard: Markup.inlineKeyboard(rows) };
}

export function renderClassHome(cls, role = 'owner') {
  const g = cls.rowId;
  const caps = capsFor(role);
  const rows = [];
  if (caps.editRoster) rows.push([Markup.button.callback(OT.rosterButton, `o:roster:${g}:0`)]);
  rows.push([Markup.button.callback(OT.sessionsButton, `o:sessions:${g}`)]);
  if (caps.createSession) rows.push([Markup.button.callback(OT.newSessionButton, `o:newsess:${g}`)]);
  if (caps.editTeachers) rows.push([Markup.button.callback(OT.teachersButton, `o:teach:${g}`)]);
  rows.push([Markup.button.callback(OT.reportButton, `o:rep:${g}:1`)]);
  if (caps.manageClass) {
    rows.push([Markup.button.callback(OT.renameClassButton, `o:crename:${g}`)]);
    rows.push([Markup.button.callback(OT.managersButton, `o:mgrs:${g}`)]);
  }
  // Owned classes return to "my classes"; delegated ones to "shared with me".
  const back = role === 'owner' ? 'o:mine' : 'o:shared';
  rows.push([Markup.button.callback(TEXT.backButton, back), ...dismissRow()]);
  return { text: OT.classHome(cls.name), keyboard: Markup.inlineKeyboard(rows) };
}

export function renderRoster(cls, members, page = 0) {
  const g = cls.rowId;
  // Roster is ordered by the stable list number teachers know (not the alphabet);
  // students without a number sort last, alphabetically.
  const sorted = [...(members || [])].sort((a, b) => {
    const la = a.listNumber, lb = b.listNumber;
    if (la == null && lb == null) return String(a.name).localeCompare(String(b.name), 'ar');
    if (la == null) return 1;
    if (lb == null) return -1;
    return la - lb;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / ROSTER_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ROSTER_PAGE_SIZE;
  const slice = sorted.slice(start, start + ROSTER_PAGE_SIZE);

  const rows = [[Markup.button.callback(OT.addStudentsButton, `o:addstu:${g}`)]];
  // Each student is a tappable button (by list number) that opens her menu.
  for (const m of slice) {
    const label = clampButtonLabel(`${m.listNumber != null ? m.listNumber : '•'}. ${m.name}`);
    rows.push([Markup.button.callback(label, `o:stu:${g}:${m.listNumber}:${safePage}`)]);
  }
  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `o:roster:${g}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'o:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `o:roster:${g}:${safePage + 1}`)] : []),
    ]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  const hint = sorted.length ? OT.rosterManageHint : OT.rosterEmpty;
  return { text: `${OT.rosterTitle(cls.name, sorted.length)}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Per-student menu: rename or remove. `page` is remembered so back returns to the
// same roster page.
export function renderStudentMenu(cls, student, page = 0) {
  const g = cls.rowId;
  const ln = student.listNumber;
  const rows = [
    [Markup.button.callback(OT.renameStudentButton, `o:srename:${g}:${ln}:${page}`)],
    [Markup.button.callback(OT.removeStudentButton, `o:sremove:${g}:${ln}:${page}`)],
    [Markup.button.callback(TEXT.backButton, `o:roster:${g}:${page}`), ...dismissRow()],
  ];
  return { text: OT.studentMenuTitle(student.name, ln), keyboard: Markup.inlineKeyboard(rows) };
}

// Remove confirmation for a student before soft-deleting her.
export function renderRemoveStudentConfirm(cls, student, page = 0) {
  const g = cls.rowId;
  const ln = student.listNumber;
  const rows = [
    [Markup.button.callback(OT.confirmRemoveStudentButton, `o:sremx:${g}:${ln}:${page}`)],
    [Markup.button.callback(TEXT.backButton, `o:stu:${g}:${ln}:${page}`), ...dismissRow()],
  ];
  return { text: OT.removeStudentConfirm(student.name), keyboard: Markup.inlineKeyboard(rows) };
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

// ── Managers (delegation) renderers ──────────────────────────────────────────

// A delegate's display label: her captured name, else her numeric id.
function managerLabel(m) {
  return m.displayName || `#${m.userId}`;
}

export function renderManagersMenu(cls, managers) {
  const g = cls.rowId;
  const list = Array.isArray(managers) ? managers : [];
  const rows = list.map((m) => [
    Markup.button.callback(clampButtonLabel(OT.managerRow(managerLabel(m), m.role)), `o:mgr:${g}:${m.userId}`),
  ]);
  rows.push([Markup.button.callback(OT.addManagerButton, `o:mgradd:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  const hint = list.length ? OT.managersHint : OT.managersEmpty;
  return { text: `${OT.managersTitle(cls.name)}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

export function renderAddManagerRoleMenu(cls) {
  const g = cls.rowId;
  const rows = [
    [Markup.button.callback(OT.roleOperator, `o:mgrrole:${g}:operator`)],
    [Markup.button.callback(OT.roleAssistant, `o:mgrrole:${g}:assistant`)],
    [Markup.button.callback(TEXT.backButton, `o:mgrs:${g}`), ...dismissRow()],
  ];
  return { text: OT.pickManagerRoleTitle, keyboard: Markup.inlineKeyboard(rows) };
}

export function renderManagerMenu(cls, manager) {
  const g = cls.rowId;
  const uid = manager.userId;
  const rows = [];
  // Offer the opposite role as a one-tap change.
  if (manager.role === 'assistant') rows.push([Markup.button.callback(OT.makeOperatorButton, `o:mgrset:${g}:${uid}:operator`)]);
  else rows.push([Markup.button.callback(OT.makeAssistantButton, `o:mgrset:${g}:${uid}:assistant`)]);
  rows.push([Markup.button.callback(OT.renameManagerButton, `o:mgrren:${g}:${uid}`)]);
  rows.push([Markup.button.callback(OT.removeManagerButton, `o:mgrrm:${g}:${uid}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:mgrs:${g}`), ...dismissRow()]);
  return { text: OT.managerMenuTitle(managerLabel(manager), OT.roleLabel(manager.role)), keyboard: Markup.inlineKeyboard(rows) };
}

export function renderRemoveManagerConfirm(cls, manager) {
  const g = cls.rowId;
  const uid = manager.userId;
  const rows = [
    [Markup.button.callback(OT.confirmRemoveManagerButton, `o:mgrrmx:${g}:${uid}`)],
    [Markup.button.callback(TEXT.backButton, `o:mgr:${g}:${uid}`), ...dismissRow()],
  ];
  return { text: OT.removeManagerConfirm(managerLabel(manager)), keyboard: Markup.inlineKeyboard(rows) };
}


function renderNewSessionMenu(cls) {
  const g = cls.rowId;
  const rows = OFFLINE_SESSION_TYPES.map((type) => [
    Markup.button.callback(TEXT.historyTypeTitle[type] || type, `o:mksess:${g}:${type}`),
  ]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  return { text: OT.newSessionTitle, keyboard: Markup.inlineKeyboard(rows) };
}

// Session browsing is two steps (like live history): first pick a type, then
// list that type's sessions. `scoped` is the flattened series-1 list; each
// session keeps its absolute index so the editor/menu resolve the same record.
function renderSessionTypesMenu(cls, scoped, caps = capsFor('owner')) {
  const g = cls.rowId;
  const counts = new Map();
  for (const s of scoped) counts.set(s.type, (counts.get(s.type) || 0) + 1);
  const rows = OFFLINE_SESSION_TYPES.map((type) => {
    const label = TEXT.historyTypeTitle[type] || type;
    return [Markup.button.callback(
      clampButtonLabel(OT.sessionTypeRow(label, counts.get(type) || 0)),
      `o:stype:${g}:${type}:0`,
    )];
  });
  if (caps.createSession) rows.push([Markup.button.callback(OT.newSessionButton, `o:newsess:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  return { text: `${OT.sessionsListTitle(cls.name)}\n\n${OT.pickSessionType}`, keyboard: Markup.inlineKeyboard(rows) };
}

function renderSessionsByType(cls, type, items, page = 0, caps = capsFor('owner')) {
  const g = cls.rowId;
  const typeLabel = TEXT.historyTypeTitle[type] || type;
  const totalPages = Math.max(1, Math.ceil(items.length / SESSIONS_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * SESSIONS_PAGE_SIZE;
  const rows = items.slice(start, start + SESSIONS_PAGE_SIZE).map(({ session, recordIndex }) => {
    const label = clampButtonLabel(`${recordIndex}. ${session.name} | ${fmtDate(session.endedAt || session.startedAt)}`);
    return [Markup.button.callback(label, `o:smenu:${g}:1:${recordIndex}`)];
  });
  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `o:stype:${g}:${type}:${safePage - 1}`)] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'o:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `o:stype:${g}:${type}:${safePage + 1}`)] : []),
    ]);
  }
  if (caps.createSession) rows.push([Markup.button.callback(OT.newSessionButton, `o:newsess:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:sessions:${g}`), ...dismissRow()]);
  const body = items.length ? '' : `\n\n${OT.sessionsEmpty}`;
  return { text: `${OT.sessionsByTypeTitle(cls.name, typeLabel)}${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

function renderSessionMenu(cls, recordIndex, session, teacher, caps = capsFor('owner')) {
  const g = cls.rowId;
  const teacherLine = teacher
    ? `\n👩‍🏫 ${TEXT.teacherTypeLabel[teacher.type] || ''} ${teacher.name}`
    : '';
  const text = `🗂️ *${session.name}*\n📅 ${fmtDate(session.endedAt || session.startedAt)}${teacherLine}`;
  const rows = [
    [Markup.button.callback(OT.openEditorButton, `o:session:${g}:1:${recordIndex}:0`)],
  ];
  if (caps.assignTeacher) rows.push([Markup.button.callback(OT.assignTeacherButton, `o:asgm:${g}:1:${recordIndex}`)]);
  rows.push([Markup.button.callback(OT.sessionReportButton, `o:report:${g}:1:${recordIndex}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:stype:${g}:${session.type}:0`), ...dismissRow()]);
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
    listSharedClasses,
    createOfflineClass,
    resolveManageableClass,
    getMaster,
    getTeachers,
    getSessions,
    saveSessions,
    getAllSessions,
    getSessionTeacher,
    assignSessionTeacher,
    renameOfflineStudent,
    removeOfflineStudent,
    listClassManagers,
    setClassManagerRole,
    removeClassManager,
    touchClassManagerName,
    setReplyPrompt,
  } = storage;

  // Resolve numeric gref -> class + the caller's role, gating every `o:*`
  // handler. Owner or an authorized delegate (class_managers) pass; anyone else
  // is rejected. `rc.role` drives per-action capability checks (capsFor).
  async function resolveClass(ctx) {
    const cls = await resolveManageableClass(ctx.match[1], ctx.from.id);
    if (!cls) return { ok: false, reason: OT.notFound };
    // A delegate added by numeric id starts without a name. The first time she
    // opens the class we know her ctx.from, so backfill it (fire-and-forget) so
    // the owner's managers panel shows her name instead of her id.
    if (cls.role !== 'owner' && !cls.displayName && touchClassManagerName) {
      const name = getDisplayName(ctx.from);
      if (name && name !== 'بدون اسم') {
        Promise.resolve(touchClassManagerName(cls.rowId, ctx.from.id, name)).catch(() => {});
      }
    }
    return { ok: true, cls, role: cls.role, caps: capsFor(cls.role) };
  }

  // Reject a handler when the caller's role lacks a capability.
  function denied(ctx, rc, cap) {
    if (rc.caps[cap]) return null;
    return ctx.answerCbQuery(TEXT.adminOnly);
  }

  // resolveContext for the shared session editor (registerOfflineEditor). The
  // shared editor (attendance + reports + title/verse) is open to ANY resolved
  // role; per-action gates live in the offline handlers below.
  async function editorResolve(ctx) {
    const cls = await resolveManageableClass(ctx.match[1], ctx.from.id);
    if (!cls) return { ok: false, reason: OT.notFound };
    return { ok: true, groupId: cls.groupId, gref: cls.rowId, role: cls.role, caps: capsFor(cls.role) };
  }

  // Build the top-level view: a chooser when the user both owns and is delegated
  // classes, otherwise the single non-empty list shown directly.
  async function buildRootView(userId, { back = null } = {}) {
    const [owned, shared] = await Promise.all([
      listOfflineClasses(userId),
      listSharedClasses ? listSharedClasses(userId) : [],
    ]);
    if (owned.length && shared.length) return renderRootChooser();
    if (!owned.length && shared.length) return renderSharedList(shared, { back });
    return renderClassList(owned, { back });
  }

  // /offline — private entry point.
  async function entry(ctx) {
    if (ctx.chat?.type !== 'private') return replyEphemeral(ctx, OT.chooserTitle);
    const view = await buildRootView(ctx.from.id);
    return ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  }

  async function root(ctx) {
    const view = await buildRootView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function myClasses(ctx) {
    const classes = await listOfflineClasses(ctx.from.id);
    const view = renderClassList(classes, { back: 'o:root' });
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function sharedClasses(ctx) {
    const classes = listSharedClasses ? await listSharedClasses(ctx.from.id) : [];
    const view = renderSharedList(classes, { back: 'o:root' });
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
    const view = renderClassHome(rc.cls, rc.role);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function roster(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    const page = parseInt(ctx.match[2], 10) || 0;
    const master = await getMaster(rc.cls.groupId);
    const view = renderRoster(rc.cls, master.members, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addStudentsPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineAddStudents', gref: rc.cls.rowId },
      sendPrompt: () => ctx.reply(OT.addStudentsPrompt, { reply_markup: { force_reply: true } }),
    });
  }

  // Resolve a student on a class by her list number (colon-free, stable).
  async function findStudent(cls, listNumber) {
    const master = await getMaster(cls.groupId);
    return (master.members || []).find((m) => String(m.listNumber) === String(listNumber)) || null;
  }

  async function studentMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    const listNumber = ctx.match[2];
    const page = parseInt(ctx.match[3], 10) || 0;
    const student = await findStudent(rc.cls, listNumber);
    if (!student) return ctx.answerCbQuery(OT.studentNotFound);
    const view = renderStudentMenu(rc.cls, student, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function renameStudentPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    const listNumber = ctx.match[2];
    const page = parseInt(ctx.match[3], 10) || 0;
    const student = await findStudent(rc.cls, listNumber);
    if (!student) return ctx.answerCbQuery(OT.studentNotFound);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineRenameStudent', gref: rc.cls.rowId, listNumber, page },
      sendPrompt: () => ctx.reply(OT.renameStudentPrompt(student.name), { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function removeStudentConfirmView(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    const listNumber = ctx.match[2];
    const page = parseInt(ctx.match[3], 10) || 0;
    const student = await findStudent(rc.cls, listNumber);
    if (!student) return ctx.answerCbQuery(OT.studentNotFound);
    const view = renderRemoveStudentConfirm(rc.cls, student, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeStudent(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editRoster')) return undefined;
    const listNumber = ctx.match[2];
    const page = parseInt(ctx.match[3], 10) || 0;
    const res = await removeOfflineStudent(rc.cls.groupId, listNumber);
    if (!res.ok) return ctx.answerCbQuery(OT.studentNotFound);
    const master = await getMaster(rc.cls.groupId);
    const view = renderRoster(rc.cls, master.members, page);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(OT.studentRemoved(res.name).replace(/\*/g, ''));
  }

  async function renameClassPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
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
    if (denied(ctx, rc, 'editTeachers')) return undefined;
    const list = await getTeachers(rc.cls.groupId);
    const view = renderTeachers(rc.cls, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addTeacherPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'editTeachers')) return undefined;
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
    if (denied(ctx, rc, 'createSession')) return undefined;
    const view = renderNewSessionMenu(rc.cls);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function createSession(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'createSession')) return undefined;
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

  async function sessionTypesMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    const view = renderSessionTypesMenu(rc.cls, scoped, rc.caps);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function sessionsByType(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    const type = ctx.match[2];
    const page = parseInt(ctx.match[3], 10) || 0;
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    // Keep each session's absolute index so the editor/menu resolve the same
    // record after filtering by type.
    const items = scoped
      .map((session, i) => ({ session, recordIndex: i + 1 }))
      .filter(({ session }) => session.type === type);
    const view = renderSessionsByType(rc.cls, type, items, page, rc.caps);
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
    const view = renderSessionMenu(rc.cls, recordIndex, picked, teacher, rc.caps);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacherMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'assignTeacher')) return undefined;
    const recordIndex = parseInt(ctx.match[3], 10);
    const list = await getTeachers(rc.cls.groupId);
    const view = renderAssignTeacherMenu(rc.cls, recordIndex, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacher(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'assignTeacher')) return undefined;
    const recordIndex = parseInt(ctx.match[3], 10);
    const teacherId = parseInt(ctx.match[4], 10);
    const all = await getAllSessions(rc.cls.groupId);
    const scoped = sessionsInSeries(all, 1);
    const picked = scoped[recordIndex - 1];
    if (!picked) return ctx.answerCbQuery(TEXT.invalidRecordIndex);

    await assignSessionTeacher(rc.cls.groupId, picked.id, teacherId || null);
    const teacher = teacherId ? await getSessionTeacher(picked.id) : null;
    const view = renderSessionMenu(rc.cls, recordIndex, picked, teacher, rc.caps);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(teacher ? OT.teacherAssigned(teacher.name) : OT.teacherCleared);
  }

  // ── Managers (delegation) handlers ─────────────────────────────────────────

  async function findManager(cls, userId) {
    const list = await listClassManagers(cls.rowId);
    return list.find((m) => String(m.userId) === String(userId)) || null;
  }

  async function managersMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const list = await listClassManagers(rc.cls.rowId);
    const view = renderManagersMenu(rc.cls, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addManagerRoleMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const view = renderAddManagerRoleMenu(rc.cls);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addManagerPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const role = ctx.match[2] === 'assistant' ? 'assistant' : 'operator';
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineAddManager', gref: rc.cls.rowId, role },
      sendPrompt: () => ctx.reply(OT.addManagerIdPrompt(OT.roleLabel(role)), {
        parse_mode: 'Markdown', reply_markup: { force_reply: true },
      }),
    });
  }

  async function managerMenu(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const manager = await findManager(rc.cls, ctx.match[2]);
    if (!manager) return ctx.answerCbQuery(OT.managerNotFound);
    const view = renderManagerMenu(rc.cls, manager);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function setManagerRole(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const userId = ctx.match[2];
    const role = ctx.match[3] === 'assistant' ? 'assistant' : 'operator';
    const res = await setClassManagerRole(rc.cls.rowId, userId, role);
    if (!res.ok) return ctx.answerCbQuery(OT.managerNotFound);
    const manager = await findManager(rc.cls, userId);
    if (!manager) return ctx.answerCbQuery(OT.managerNotFound);
    const view = renderManagerMenu(rc.cls, manager);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(OT.managerRoleChanged(OT.roleLabel(role)).replace(/\*/g, ''));
  }

  async function renameManagerPrompt(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const manager = await findManager(rc.cls, ctx.match[2]);
    if (!manager) return ctx.answerCbQuery(OT.managerNotFound);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: rc.cls.groupId,
      record: { action: 'offlineRenameManager', gref: rc.cls.rowId, uid: String(manager.userId) },
      sendPrompt: () => ctx.reply(OT.renameManagerPrompt(manager.displayName || `#${manager.userId}`), {
        parse_mode: 'Markdown', reply_markup: { force_reply: true },
      }),
    });
  }

  async function removeManagerConfirmView(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const manager = await findManager(rc.cls, ctx.match[2]);
    if (!manager) return ctx.answerCbQuery(OT.managerNotFound);
    const view = renderRemoveManagerConfirm(rc.cls, manager);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeManager(ctx) {
    const rc = await resolveClass(ctx);
    if (!rc.ok) return ctx.answerCbQuery(rc.reason);
    if (denied(ctx, rc, 'manageClass')) return undefined;
    const manager = await findManager(rc.cls, ctx.match[2]);
    await removeClassManager(rc.cls.rowId, ctx.match[2]);
    const list = await listClassManagers(rc.cls.rowId);
    const view = renderManagersMenu(rc.cls, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    const label = manager ? (manager.displayName || `#${manager.userId}`) : '';
    await ctx.answerCbQuery(OT.managerRemoved(label).replace(/\*/g, ''));
  }

  async function noop(ctx) {
    return ctx.answerCbQuery();
  }

  return {
    entry,
    root,
    myClasses,
    sharedClasses,
    newClassPrompt,
    classHome,
    roster,
    addStudentsPrompt,
    studentMenu,
    renameStudentPrompt,
    removeStudentConfirmView,
    removeStudent,
    renameClassPrompt,
    teachers,
    addTeacherPrompt,
    newSessionMenu,
    createSession,
    sessionTypesMenu,
    sessionsByType,
    sessionMenu,
    assignTeacherMenu,
    assignTeacher,
    managersMenu,
    addManagerRoleMenu,
    addManagerPrompt,
    managerMenu,
    setManagerRole,
    renameManagerPrompt,
    removeManagerConfirmView,
    removeManager,
    noop,
    editorResolve,
  };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });

  bot.command('offline', h.entry);

  bot.action('o:root', h.root);
  bot.action('o:mine', h.myClasses);
  bot.action('o:shared', h.sharedClasses);
  bot.action('o:new', h.newClassPrompt);
  bot.action('o:noop', h.noop);
  bot.action(/^o:cls:(\d+)$/, h.classHome);
  bot.action(/^o:roster:(\d+):(\d+)$/, h.roster);
  bot.action(/^o:addstu:(\d+)$/, h.addStudentsPrompt);
  bot.action(/^o:stu:(\d+):(\d+):(\d+)$/, h.studentMenu);
  bot.action(/^o:srename:(\d+):(\d+):(\d+)$/, h.renameStudentPrompt);
  bot.action(/^o:sremove:(\d+):(\d+):(\d+)$/, h.removeStudentConfirmView);
  bot.action(/^o:sremx:(\d+):(\d+):(\d+)$/, h.removeStudent);
  bot.action(/^o:crename:(\d+)$/, h.renameClassPrompt);
  bot.action(/^o:teach:(\d+)$/, h.teachers);
  bot.action(/^o:addteach:(\d+)$/, h.addTeacherPrompt);
  bot.action(/^o:newsess:(\d+)$/, h.newSessionMenu);
  bot.action(/^o:mksess:(\d+):([a-zA-Z]+)$/, h.createSession);
  bot.action(/^o:sessions:(\d+)$/, h.sessionTypesMenu);
  bot.action(/^o:stype:(\d+):([a-zA-Z]+):(\d+)$/, h.sessionsByType);
  bot.action(/^o:smenu:(\d+):(\d+):(\d+)$/, h.sessionMenu);
  bot.action(/^o:asgm:(\d+):(\d+):(\d+)$/, h.assignTeacherMenu);
  bot.action(/^o:asg:(\d+):(\d+):(\d+):(\d+)$/, h.assignTeacher);

  // Managers (delegation) — owner-only panels. User ids are numeric Telegram ids.
  bot.action(/^o:mgrs:(\d+)$/, h.managersMenu);
  bot.action(/^o:mgradd:(\d+)$/, h.addManagerRoleMenu);
  bot.action(/^o:mgrrole:(\d+):([a-zA-Z]+)$/, h.addManagerPrompt);
  bot.action(/^o:mgr:(\d+):(\d+)$/, h.managerMenu);
  bot.action(/^o:mgrset:(\d+):(\d+):([a-zA-Z]+)$/, h.setManagerRole);
  bot.action(/^o:mgrren:(\d+):(\d+)$/, h.renameManagerPrompt);
  bot.action(/^o:mgrrm:(\d+):(\d+)$/, h.removeManagerConfirmView);
  bot.action(/^o:mgrrmx:(\d+):(\d+)$/, h.removeManager);

  // The per-session attendance editor is the shared history editor under `o:`.
  // Offline classes order students by roster list number (not the alphabet) and
  // send the editor's back buttons to the offline session menu / class home
  // instead of the generic history panels.
  registerOfflineEditor(bot, storage, h.editorResolve, {
    orderNames: (session) => participants.namesByListNumber(session),
    backBuilders: (gref) => ({
      backToSessions: (recordIndex) => `o:smenu:${gref}:1:${recordIndex}`,
      backToHome: () => `o:cls:${gref}`,
    }),
  });
}

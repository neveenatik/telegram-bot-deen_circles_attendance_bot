// /manage — a single admin control hub.
//
// Live session lists stay in the group (students tap them). Every OTHER admin
// surface is reached from this private hub: it is delivered to the admin's DM
// (like /students, /pendingstudents, /classhistory) and its buttons launch the
// existing panels by editing the hub message in place. Each button carries the
// originating group id (`mg:<action>:<groupId>`) so taps authorize against that
// group even though isAdmin(ctx) is false in a private chat.
//
// The offline button points straight at the existing `o:root` callback — offline
// classes are user-owned (group-agnostic) and self-gate, so no new wiring there.
import { Markup } from 'telegraf';
import { isAdmin, isAdminOf } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral, logTelegramError, beginForceReplyAwaiting, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb } from '../../widgets.js';
import { pendingStudentsText, pendingStudentsKb } from './members.js';
import { historyHomeKb } from './history.js';
import { sessionsInSeries, clampButtonLabel } from '../../historyUtils.js';

const HUB = TEXT.manageHub;
// Group teachers reuse the offline teachers panel's wording verbatim; only the
// add prompt differs (group teachers need a userId), which lives on HUB.
const OT = TEXT.offline;
export const GROUP_TEACHER_TYPES = ['courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher'];

// The hub panel itself. Members/pending/history/teachers buttons carry the group
// id; the offline button reuses the existing user-owned `o:root` entry.
function hubView(groupId) {
  return {
    text: HUB.title,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback(HUB.membersButton, `mg:members:${groupId}`)],
      [Markup.button.callback(HUB.pendingButton, `mg:pending:${groupId}`)],
      [Markup.button.callback(HUB.historyButton, `mg:history:${groupId}`)],
      [Markup.button.callback(HUB.teachersButton, `mg:teach:${groupId}`)],
      [Markup.button.callback(HUB.trainingGroupsButton, `mg:tgroups:${groupId}`)],
      [Markup.button.callback(HUB.materialsButton, `mg:mat:${groupId}`)],
      [Markup.button.callback(HUB.homeworkButton, `mg:hw:${groupId}`)],
      [Markup.button.callback(HUB.offlineButton, 'o:root')],
      [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
    ]),
  };
}

// ── Group teachers editor renderers ──────────────────────────────────────────
// Group teachers are `{ userId, name, type }` (userId lets them be mentioned).
// They have no stable id, so callbacks key on the unique numeric userId.

export function groupTeachersView(groupId, teachers) {
  const list = Array.isArray(teachers) ? teachers : [];
  const rows = [[Markup.button.callback(OT.addTeacherButton, `mg:tadd:${groupId}`)]];
  for (const type of GROUP_TEACHER_TYPES) {
    for (const t of list.filter((x) => x.type === type)) {
      const typeLabel = TEXT.teacherTypeLabel[t.type] || t.type;
      rows.push([Markup.button.callback(clampButtonLabel(`${t.name} — ${typeLabel}`), `mg:tch:${groupId}:${t.userId}`)]);
    }
  }
  rows.push([Markup.button.callback(HUB.backButton, `mg:home:${groupId}`)]);
  rows.push([Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]);
  const hint = list.length ? OT.teachersManageHint : OT.teachersEmpty;
  return { text: `${OT.teachersTitle}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

export function groupTeacherMenuView(groupId, teacher) {
  const uid = teacher.userId;
  const typeLabel = TEXT.teacherTypeLabel[teacher.type] || teacher.type;
  const rows = [
    [Markup.button.callback(OT.renameTeacherButton, `mg:tren:${groupId}:${uid}`)],
    [Markup.button.callback(OT.changeTeacherTypeButton, `mg:ttype:${groupId}:${uid}`)],
    [Markup.button.callback(OT.removeTeacherButton, `mg:trm:${groupId}:${uid}`)],
    [Markup.button.callback(TEXT.backButton, `mg:teach:${groupId}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ];
  return { text: OT.teacherMenuTitle(teacher.name, typeLabel), keyboard: Markup.inlineKeyboard(rows) };
}

function groupTeacherTypeView(groupId, teacher) {
  const uid = teacher.userId;
  const rows = GROUP_TEACHER_TYPES.map((type) => {
    const label = TEXT.teacherTypeLabel[type] || type;
    const mark = type === teacher.type ? '✅ ' : '';
    return [Markup.button.callback(`${mark}${label}`, `mg:ttset:${groupId}:${uid}:${type}`)];
  });
  rows.push([Markup.button.callback(TEXT.backButton, `mg:tch:${groupId}:${uid}`)]);
  rows.push([Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]);
  return { text: OT.pickTeacherTypeTitle(teacher.name), keyboard: Markup.inlineKeyboard(rows) };
}

function groupRemoveTeacherView(groupId, teacher) {
  const uid = teacher.userId;
  const rows = [
    [Markup.button.callback(OT.confirmRemoveTeacherButton, `mg:trmx:${groupId}:${uid}`)],
    [Markup.button.callback(TEXT.backButton, `mg:tch:${groupId}:${uid}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ];
  return { text: OT.removeTeacherConfirm(teacher.name), keyboard: Markup.inlineKeyboard(rows) };
}

export function groupTrainingGroupsView(groupId, groups) {
  const list = Array.isArray(groups) ? groups : [];
  const rows = [[Markup.button.callback(HUB.addTrainingGroupButton, `mg:tgadd:${groupId}`)]];
  for (const g of list) {
    rows.push([Markup.button.callback(clampButtonLabel(g.name), `mg:tg:${groupId}:${g.groupId}`)]);
  }
  rows.push([Markup.button.callback(HUB.backButton, `mg:home:${groupId}`)]);
  rows.push([Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]);
  const hint = list.length ? HUB.trainingGroupsManageHint : HUB.trainingGroupsEmptyHint;
  return { text: `${HUB.trainingGroupsTitle}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

export function groupTrainingGroupMenuView(groupId, group) {
  const rows = [
    [Markup.button.callback(HUB.trainingGroupStudentsButton, `mg:tgstu:${groupId}:${group.groupId}`)],
    [Markup.button.callback(HUB.renameTrainingGroupButton, `mg:tgren:${groupId}:${group.groupId}`)],
    [Markup.button.callback(HUB.removeTrainingGroupButton, `mg:tgrm:${groupId}:${group.groupId}`)],
    [Markup.button.callback(TEXT.backButton, `mg:tgroups:${groupId}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ];
  return { text: HUB.trainingGroupMenuTitle(group.name), keyboard: Markup.inlineKeyboard(rows) };
}

// View-only: the training group's own roster (its members self-register in that
// linked Telegram group). Names only, with back to the group menu.
export function groupTrainingGroupStudentsView(groupId, group, members) {
  const list = Array.isArray(members) ? members : [];
  const lines = list.map((m, i) => `${i + 1}. ${escapeTelegramMarkdown(m.name)}`).join('\n');
  const body = list.length
    ? `${HUB.trainingGroupStudentsTitle(group.name, list.length)}\n\n${lines}`
    : `${HUB.trainingGroupStudentsTitle(group.name, 0)}\n\n${HUB.trainingGroupStudentsEmpty}`;
  const rows = [
    [Markup.button.callback(TEXT.backButton, `mg:tg:${groupId}:${group.groupId}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ];
  return { text: body, keyboard: Markup.inlineKeyboard(rows) };
}

function groupRemoveTrainingGroupView(groupId, group) {
  const rows = [
    [Markup.button.callback(HUB.confirmRemoveTrainingGroupButton, `mg:tgrmx:${groupId}:${group.groupId}`)],
    [Markup.button.callback(TEXT.backButton, `mg:tg:${groupId}:${group.groupId}`)],
    [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
  ];
  return { text: HUB.removeTrainingGroupConfirm(group.name), keyboard: Markup.inlineKeyboard(rows) };
}

// Splice a "back to the hub" row just above a panel's trailing Close row, without
// touching the shared builders (so /students, /classhistory, etc. are unchanged).
function withBackToHub(markup, groupId) {
  const kb = markup?.reply_markup?.inline_keyboard;
  if (Array.isArray(kb)) {
    const backRow = [{ text: HUB.backButton, callback_data: `mg:home:${groupId}` }];
    kb.splice(Math.max(0, kb.length - 1), 0, backRow);
  }
  return markup;
}

export function createHandlers({ storage, telegram }) {
  const { getMaster, getPendingRegistrations, getAllSessions, getCurrentSeries, getTeachers, saveTeachers, getTrainingGroups, saveTrainingGroups, setParentGroup, setReplyPrompt } = storage;

  // Hub actions are delivered to the admin's DM, so each callback encodes the
  // real group id as ctx.match[1]; gate on membership of that group.
  const ensureAdmin = (ctx) => isAdminOf(telegram, ctx.match[1], ctx.from.id);

  async function findTeacher(groupId, uid) {
    const list = await getTeachers(groupId);
    return { list: list || [], teacher: (list || []).find((t) => String(t.userId) === String(uid)) || null };
  }

  async function findTrainingGroup(groupId, tgId) {
    const list = await getTrainingGroups(groupId);
    return { list: list || [], group: (list || []).find((g) => String(g.groupId) === String(tgId)) || null };
  }

  async function dmNudge(ctx, groupId) {
    let username = ctx.botInfo?.username;
    if (!username) {
      try { username = (await telegram.getMe())?.username; } catch { username = null; }
    }
    const link = username ? `https://t.me/${username}?start=manage` : null;
    await replyEphemeral(ctx, TEXT.startBotInDmNudge(link));
  }

  // /manage — group command. Deliver the hub privately.
  async function manage(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const view = hubView(groupId);
    try {
      await telegram.sendMessage(ctx.from.id, view.text, { parse_mode: 'Markdown', ...view.keyboard });
      await replyEphemeral(ctx, TEXT.panelSentToDm);
    } catch (err) {
      await dmNudge(ctx, groupId);
      logTelegramError('hub.manage.dmSend', err, { chatId: String(groupId) });
    }
  }

  async function home(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const view = hubView(ctx.match[1]);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function openMembers(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    await ctx.editMessageText(membersText(master), {
      parse_mode: 'Markdown',
      ...withBackToHub(membersKb(groupId, master), groupId),
    });
    await ctx.answerCbQuery();
  }

  async function openPending(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    await ctx.editMessageText(pendingStudentsText(pending), {
      parse_mode: 'Markdown',
      ...withBackToHub(pendingStudentsKb(groupId, pending), groupId),
    });
    await ctx.answerCbQuery();
  }

  async function openHistory(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const all = await getAllSessions(groupId);
    const series = await getCurrentSeries(groupId);
    const scoped = sessionsInSeries(all, series);
    if (!scoped.length) return ctx.answerCbQuery(TEXT.noSeriesRecords(series), { show_alert: true });
    await ctx.editMessageText(TEXT.historyHomeText(series, scoped.length), {
      parse_mode: 'Markdown',
      ...withBackToHub(historyHomeKb(groupId, series), groupId),
    });
    await ctx.answerCbQuery();
  }

  async function openTeachers(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const list = await getTeachers(groupId);
    const view = groupTeachersView(groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function teacherMenu(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    const view = groupTeacherMenuView(groupId, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function teacherTypeMenu(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    const view = groupTeacherTypeView(groupId, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function setTeacherType(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const type = ctx.match[3];
    if (!GROUP_TEACHER_TYPES.includes(type)) return ctx.answerCbQuery(OT.teacherNotFound);
    const { list, teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    teacher.type = type;
    await saveTeachers(groupId, list);
    const view = groupTeacherMenuView(groupId, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(OT.teacherTypeChanged(TEXT.teacherTypeLabel[type] || type));
  }

  async function removeTeacherConfirmView(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    const view = groupRemoveTeacherView(groupId, teacher);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeTeacher(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { list, teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    const next = list.filter((t) => String(t.userId) !== String(ctx.match[2]));
    await saveTeachers(groupId, next);
    const view = groupTeachersView(groupId, next);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(OT.teacherRemoved(teacher.name).replace(/\*/g, ''));
  }

  // Add/rename need free text, so they open a force-reply prompt whose answer is
  // routed back by text.js (actions `groupAddTeacher` / `groupRenameTeacher`).
  async function addTeacherPrompt(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'groupAddTeacher' },
      sendPrompt: () => ctx.reply(HUB.addTeacherPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function renameTeacherPrompt(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { teacher } = await findTeacher(groupId, ctx.match[2]);
    if (!teacher) return ctx.answerCbQuery(OT.teacherNotFound);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'groupRenameTeacher', teacherUserId: String(teacher.userId) },
      sendPrompt: () => ctx.reply(OT.renameTeacherPrompt(teacher.name), { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  // ── Training-groups editor handlers ─────────────────────────────────────────

  async function openTrainingGroups(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const list = await getTrainingGroups(groupId);
    const view = groupTrainingGroupsView(groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function trainingGroupMenu(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { group } = await findTrainingGroup(groupId, ctx.match[2]);
    if (!group) return ctx.answerCbQuery(HUB.trainingGroupMissing);
    const view = groupTrainingGroupMenuView(groupId, group);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function trainingGroupStudents(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { group } = await findTrainingGroup(groupId, ctx.match[2]);
    if (!group) return ctx.answerCbQuery(HUB.trainingGroupMissing);
    const master = await getMaster(group.groupId);
    const view = groupTrainingGroupStudentsView(groupId, group, master.members);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeTrainingGroupConfirmView(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { group } = await findTrainingGroup(groupId, ctx.match[2]);
    if (!group) return ctx.answerCbQuery(HUB.trainingGroupMissing);
    const view = groupRemoveTrainingGroupView(groupId, group);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeTrainingGroup(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { list, group } = await findTrainingGroup(groupId, ctx.match[2]);
    if (!group) return ctx.answerCbQuery(HUB.trainingGroupMissing);
    const next = list.filter((g) => String(g.groupId) !== String(ctx.match[2]));
    await saveTrainingGroups(groupId, next);
    const view = groupTrainingGroupsView(groupId, next);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(HUB.trainingGroupRemovedToast(group.name));
  }

  // Add/rename need free text (id | name / name), routed back by text.js
  // (actions `groupAddTrainingGroup` / `groupRenameTrainingGroup`).
  async function addTrainingGroupPrompt(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'groupAddTrainingGroup' },
      sendPrompt: () => ctx.reply(HUB.addTrainingGroupPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function renameTrainingGroupPrompt(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const { group } = await findTrainingGroup(groupId, ctx.match[2]);
    if (!group) return ctx.answerCbQuery(HUB.trainingGroupMissing);
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'groupRenameTrainingGroup', trainingGroupId: String(group.groupId) },
      sendPrompt: () => ctx.reply(HUB.renameTrainingGroupPrompt(group.name), { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  return {
    manage, home, openMembers, openPending, openHistory,
    openTeachers, teacherMenu, teacherTypeMenu, setTeacherType,
    removeTeacherConfirmView, removeTeacher, addTeacherPrompt, renameTeacherPrompt,
    openTrainingGroups, trainingGroupMenu, removeTrainingGroupConfirmView,
    removeTrainingGroup, addTrainingGroupPrompt, renameTrainingGroupPrompt,
    trainingGroupStudents,
  };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('manage', h.manage);
  bot.action(/^mg:home:(-?\d+)$/, h.home);
  bot.action(/^mg:members:(-?\d+)$/, h.openMembers);
  bot.action(/^mg:pending:(-?\d+)$/, h.openPending);
  bot.action(/^mg:history:(-?\d+)$/, h.openHistory);
  bot.action(/^mg:teach:(-?\d+)$/, h.openTeachers);
  bot.action(/^mg:tadd:(-?\d+)$/, h.addTeacherPrompt);
  bot.action(/^mg:tch:(-?\d+):(\d+)$/, h.teacherMenu);
  bot.action(/^mg:tren:(-?\d+):(\d+)$/, h.renameTeacherPrompt);
  bot.action(/^mg:ttype:(-?\d+):(\d+)$/, h.teacherTypeMenu);
  bot.action(/^mg:ttset:(-?\d+):(\d+):([a-z]+)$/, h.setTeacherType);
  bot.action(/^mg:trm:(-?\d+):(\d+)$/, h.removeTeacherConfirmView);
  bot.action(/^mg:trmx:(-?\d+):(\d+)$/, h.removeTeacher);
  bot.action(/^mg:tgroups:(-?\d+)$/, h.openTrainingGroups);
  bot.action(/^mg:tgadd:(-?\d+)$/, h.addTrainingGroupPrompt);
  bot.action(/^mg:tg:(-?\d+):(-?\d+)$/, h.trainingGroupMenu);
  bot.action(/^mg:tgstu:(-?\d+):(-?\d+)$/, h.trainingGroupStudents);
  bot.action(/^mg:tgren:(-?\d+):(-?\d+)$/, h.renameTrainingGroupPrompt);
  bot.action(/^mg:tgrm:(-?\d+):(-?\d+)$/, h.removeTrainingGroupConfirmView);
  bot.action(/^mg:tgrmx:(-?\d+):(-?\d+)$/, h.removeTrainingGroup);
}

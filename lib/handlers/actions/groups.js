import { isAdminOf } from '../../guards.js';
import { sortArabic, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersPageOfIndex } from '../../widgets.js';

const TRAINING_GROUPS_PAGE_SIZE = 6;

function trainingGroupsPickText(memberName, groups, page = 0) {
  const totalPages = Math.max(1, Math.ceil(groups.length / TRAINING_GROUPS_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  return `${TEXT.assignTrainingGroupPrompt(memberName)}\n\n${TEXT.trainingGroupsHeader(groups.length)}\n📄 صفحة ${safePage + 1}/${totalPages}`;
}

function trainingGroupsPickKb(groupId, idx, membersPage, groups, page = 0) {
  const totalPages = Math.max(1, Math.ceil(groups.length / TRAINING_GROUPS_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TRAINING_GROUPS_PAGE_SIZE;
  const slice = groups.slice(start, start + TRAINING_GROUPS_PAGE_SIZE);

  const rows = slice.map((g) => ([
    {
      text: `➕ ${g.name}`,
      callback_data: `mb:${groupId}:atrainpick:${idx}:${membersPage}:${g.groupId}`,
    },
  ]));

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [{ text: '⬅️', callback_data: `mb:${groupId}:atrainpage:${idx}:${membersPage}:${safePage - 1}` }] : []),
      { text: `📄 ${safePage + 1}/${totalPages}`, callback_data: `mb:${groupId}:noop` },
      ...(safePage < totalPages - 1 ? [{ text: '➡️', callback_data: `mb:${groupId}:atrainpage:${idx}:${membersPage}:${safePage + 1}` }] : []),
    ]);
  }

  rows.push([{ text: TEXT.backButton, callback_data: `mb:${groupId}:pick:${idx}` }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function trainingUnassignText(memberName, assignedGroupName) {
  return `${TEXT.unassignTrainingGroupPrompt(memberName)}\n\n🏷️ *المجموعة الحالية:* ${escapeTelegramMarkdown(assignedGroupName)}`;
}

function trainingUnassignKb(groupId, idx, membersPage, assignedGroup) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `➖ ${assignedGroup.name}`, callback_data: `mb:${groupId}:atrainunpick:${idx}:${membersPage}:${assignedGroup.groupId}` }],
        [{ text: TEXT.backButton, callback_data: `mb:${groupId}:pick:${idx}` }],
      ],
    },
  };
}

export function createHandlers({ storage, telegram }) {
  const { getMaster, saveMaster, getTrainingGroups } = storage;
  // Training sub-panel (mb:atrain*) is part of the DM members panel, so gate on
  // membership of the encoded group (ctx.match[1]) rather than chat admin.
  const ensureAdmin = (ctx) => isAdminOf(telegram, ctx.match[1], ctx.from.id);

  async function resolveAssignedTrainingGroup(groupId, memberUserId) {
    const groups = await getTrainingGroups(groupId);
    for (const group of groups) {
      const trainingMaster = await getMaster(group.groupId);
      const members = Array.isArray(trainingMaster.members) ? trainingMaster.members : [];
      if (members.find((m) => String(m.userId) === String(memberUserId))) {
        return group;
      }
    }
    return null;
  }

  async function assign(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map((m) => m.name));
    const i = parseInt(ctx.match[2], 10);
    const page = parseInt(ctx.match[3], 10);
    const name = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const selected = master.members.find((m) => m.name === name);
    if (!selected) return ctx.answerCbQuery(TEXT.memberNotFound);

    const assignedTraining = await resolveAssignedTrainingGroup(groupId, selected.userId);
    if (assignedTraining) {
      await ctx.editMessageText(
        trainingUnassignText(selected.name, assignedTraining.name),
        {
          parse_mode: 'Markdown',
          ...trainingUnassignKb(groupId, i, Number.isInteger(page) ? page : membersPageOfIndex(i), assignedTraining),
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    const groups = await getTrainingGroups(groupId);
    if (!groups.length) {
      return ctx.answerCbQuery(TEXT.trainingGroupsEmpty, { show_alert: true });
    }

    await ctx.editMessageText(
      trainingGroupsPickText(selected.name, groups, 0),
      { parse_mode: 'Markdown', ...trainingGroupsPickKb(groupId, i, Number.isInteger(page) ? page : membersPageOfIndex(i), groups, 0) }
    );
    await ctx.answerCbQuery();
  }

  async function unassign(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map((m) => m.name));
    const i = parseInt(ctx.match[2], 10);
    const membersPage = parseInt(ctx.match[3], 10);
    const trainingGroupId = String(ctx.match[4]);
    const name = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const selected = master.members.find((m) => m.name === name);
    if (!selected) return ctx.answerCbQuery(TEXT.memberNotFound);

    const groups = await getTrainingGroups(groupId);
    const configured = groups.find((g) => String(g.groupId) === trainingGroupId);
    if (!configured) return ctx.answerCbQuery(TEXT.trainingGroupNotFound(trainingGroupId), { show_alert: true });

    let removedAny = false;
    for (const group of groups) {
      const m = await getMaster(group.groupId);
      const list = Array.isArray(m.members) ? m.members : [];
      const next = list.filter((row) => String(row.userId) !== String(selected.userId));
      if (next.length !== list.length) {
        removedAny = true;
        m.members = next;
        await saveMaster(group.groupId, m);
      }
    }
    if (!removedAny) return ctx.answerCbQuery(TEXT.trainingStudentNotFoundInTraining(selected.name));

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      {
        parse_mode: 'Markdown',
        ...memberOptionsKb(groupId, i, Number.isInteger(membersPage) ? membersPage : membersPageOfIndex(i), null),
      }
    );
    return ctx.answerCbQuery(TEXT.trainingUnassignedFromWidget(selected.name, trainingGroupId));
  }

  async function page(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map((m) => m.name));
    const i = parseInt(ctx.match[2], 10);
    const membersPage = parseInt(ctx.match[3], 10);
    const groupsPage = parseInt(ctx.match[4], 10);
    const name = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const groups = await getTrainingGroups(groupId);
    if (!groups.length) return ctx.answerCbQuery(TEXT.trainingGroupsEmpty, { show_alert: true });

    await ctx.editMessageText(
      trainingGroupsPickText(name, groups, Number.isInteger(groupsPage) ? groupsPage : 0),
      { parse_mode: 'Markdown', ...trainingGroupsPickKb(groupId, i, Number.isInteger(membersPage) ? membersPage : membersPageOfIndex(i), groups, Number.isInteger(groupsPage) ? groupsPage : 0) }
    );
    await ctx.answerCbQuery();
  }

  async function pick(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map((m) => m.name));
    const i = parseInt(ctx.match[2], 10);
    const membersPage = parseInt(ctx.match[3], 10);
    const trainingGroupId = String(ctx.match[4]);
    const name = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const selected = master.members.find((m) => m.name === name);
    if (!selected) return ctx.answerCbQuery(TEXT.memberNotFound);

    const groups = await getTrainingGroups(groupId);
    const configured = groups.find((g) => String(g.groupId) === trainingGroupId);
    if (!configured) return ctx.answerCbQuery(TEXT.trainingGroupNotFound(trainingGroupId), { show_alert: true });

    for (const group of groups) {
      const m = await getMaster(group.groupId);
      const list = Array.isArray(m.members) ? m.members : [];
      const next = list.filter((row) => String(row.userId) !== String(selected.userId));
      if (next.length !== list.length) {
        m.members = next;
        await saveMaster(group.groupId, m);
      }
    }

    const trainingMaster = await getMaster(trainingGroupId);
    if (!Array.isArray(trainingMaster.members)) trainingMaster.members = [];
    trainingMaster.members.push({ userId: selected.userId, name: selected.name });
    await saveMaster(trainingGroupId, trainingMaster);

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      {
        parse_mode: 'Markdown',
        ...memberOptionsKb(groupId, i, Number.isInteger(membersPage) ? membersPage : membersPageOfIndex(i), configured.name),
      }
    );
    return ctx.answerCbQuery(TEXT.trainingAssignedFromWidget(selected.name, trainingGroupId));
  }

  return { assign, unassign, page, pick };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.action(/^mb:(-?\d+):atrain:(\d+):(\d+)$/, h.assign);
  bot.action(/^mb:(-?\d+):atrainunpick:(\d+):(\d+):(-?\d+)$/, h.unassign);
  bot.action(/^mb:(-?\d+):atrainpage:(\d+):(\d+):(\d+)$/, h.page);
  bot.action(/^mb:(-?\d+):atrainpick:(\d+):(\d+):(-?\d+)$/, h.pick);
}
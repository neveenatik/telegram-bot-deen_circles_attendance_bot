import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { dismissKb } from '../../widgets.js';

export function createHandlers({ storage }) {
  const { getMaster, getTrainingGroups, saveTrainingGroups } = storage;

  async function listtrainingstudents(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const trainingGroupId = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!/^-?\d+$/.test(trainingGroupId)) return replyEphemeral(ctx, TEXT.invalidTrainingGroupId);

    const trainingMaster = await getMaster(trainingGroupId);
    const members = Array.isArray(trainingMaster.members) ? trainingMaster.members : [];

    const header = TEXT.trainingStudentsListHeader(trainingGroupId, members.length);
    if (!members.length) return ctx.replyWithMarkdown(`${header}\n\n—`, dismissKb());

    const lines = members
      .map((m, i) => `${i + 1}. ${escapeTelegramMarkdown(m.name)} — \`${m.userId}\``)
      .join('\n');

    return ctx.replyWithMarkdown(`${header}\n\n${lines}`, dismissKb());
  }

  async function addtraininggroup(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const sepIndex = commandInput.indexOf('|');
    if (!commandInput || sepIndex === -1) return replyEphemeral(ctx, TEXT.invalidAddTrainingGroupFormat);

    const trainingGroupId = commandInput.slice(0, sepIndex).trim();
    const trainingGroupName = commandInput.slice(sepIndex + 1).trim();
    if (!/^-?\d+$/.test(trainingGroupId)) return replyEphemeral(ctx, TEXT.invalidTrainingGroupId);
    if (!trainingGroupName) return replyEphemeral(ctx, TEXT.invalidAddTrainingGroupFormat);

    const groups = await getTrainingGroups(groupId);
    const existingById = groups.find((g) => String(g.groupId) === trainingGroupId);
    if (existingById) {
      existingById.name = trainingGroupName;
    } else {
      groups.push({ groupId: trainingGroupId, name: trainingGroupName });
    }

    await saveTrainingGroups(groupId, groups);
    return ctx.replyWithMarkdown(TEXT.trainingGroupAdded(escapeTelegramMarkdown(trainingGroupName), trainingGroupId), dismissKb());
  }

  async function removetraininggroup(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const trainingGroupId = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!/^-?\d+$/.test(trainingGroupId)) return replyEphemeral(ctx, TEXT.invalidRemoveTrainingGroupFormat);

    const groups = await getTrainingGroups(groupId);
    const idx = groups.findIndex((g) => String(g.groupId) === trainingGroupId);
    if (idx === -1) return replyEphemeral(ctx, TEXT.trainingGroupNotFound(trainingGroupId), { parse_mode: 'Markdown' });

    const [removed] = groups.splice(idx, 1);
    await saveTrainingGroups(groupId, groups);
    return ctx.replyWithMarkdown(TEXT.trainingGroupRemoved(escapeTelegramMarkdown(removed.name), trainingGroupId), dismissKb());
  }

  async function listtraininggroups(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const groups = await getTrainingGroups(groupId);
    if (!groups.length) return replyEphemeral(ctx, TEXT.trainingGroupsEmpty);

    const header = TEXT.trainingGroupsHeader(groups.length);
    const lines = groups
      .map((g, i) => `${i + 1}. ${escapeTelegramMarkdown(g.name)} — \`${g.groupId}\``)
      .join('\n');
    return ctx.replyWithMarkdown(`${header}\n\n${lines}`, dismissKb());
  }

  return { listtrainingstudents, addtraininggroup, removetraininggroup, listtraininggroups };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.command('listtrainingstudents', h.listtrainingstudents);
  bot.command('addtraininggroup', h.addtraininggroup);
  bot.command('removetraininggroup', h.removetraininggroup);
  bot.command('listtraininggroups', h.listtraininggroups);
}
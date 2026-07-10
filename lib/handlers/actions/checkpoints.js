import { groupIdFromCtx } from '../../helpers.js';
import { getActiveSessionType } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import * as participants from '../../sessionParticipants.js';

function ensureCheckpointState(session) {
  if (!Array.isArray(session.checkpoints)) session.checkpoints = [];
}

export function createHandlers({ storage }) {
  const { getMaster, getSession, saveSession } = storage;

  async function confirm(ctx) {
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(getSession, groupId);
    if (!activeType) return ctx.answerCbQuery(TEXT.noSessionActive);

    const session = await getSession(groupId, activeType);
    if (!session?.active) return ctx.answerCbQuery(TEXT.noSessionActive);

    ensureCheckpointState(session);
    const checkpointId = parseInt(ctx.match[1], 10);
    const checkpoint = session.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) return ctx.answerCbQuery(TEXT.checkpointMissing);

    const master = await getMaster(groupId);
    const uid = String(ctx.from.id);
    const member = master.members.find((item) => String(item.userId) === uid);
    if (!member) return ctx.answerCbQuery(TEXT.needRegistration);
    if (!participants.has(session, member.name)) {
      return ctx.answerCbQuery(TEXT.checkpointNeedAttendance);
    }

    if (!checkpoint.confirmations) checkpoint.confirmations = {};
    if (checkpoint.confirmations[member.name]) {
      return ctx.answerCbQuery(TEXT.checkpointAlreadyConfirmed);
    }

    checkpoint.confirmations[member.name] = new Date().toISOString();
    await saveSession(groupId, activeType, session);

    const toast = checkpoint.kind === 'start'
      ? TEXT.checkpointConfirmedStart
      : TEXT.checkpointConfirmedReminder;
    return ctx.answerCbQuery(toast);
  }

  return { confirm };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.action(/^cp:confirm:(\d+)$/, h.confirm);
}

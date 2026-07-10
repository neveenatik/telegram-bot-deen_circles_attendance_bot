import { Markup } from 'telegraf';
import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { getActiveSessionType } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';

function ensureCheckpointState(session) {
  if (!Array.isArray(session.checkpoints)) session.checkpoints = [];
  if (!Number.isInteger(session.nextCheckpointId) || session.nextCheckpointId < 1) {
    const maxId = session.checkpoints.reduce((max, checkpoint) => {
      const current = Number.isInteger(checkpoint?.id) ? checkpoint.id : 0;
      return Math.max(max, current);
    }, 0);
    session.nextCheckpointId = maxId + 1;
  }
}

function checkpointKeyboard(kind, checkpointId) {
  const buttonText = kind === 'start' ? TEXT.checkpointStartButton : TEXT.checkpointReminderButton;
  return Markup.inlineKeyboard([
    [Markup.button.callback(buttonText, `cp:confirm:${checkpointId}`)],
    [Markup.button.callback('✕ إغلاق', 'msg:dismiss')],
  ]);
}

export function createHandlers({ storage }) {
  const { getSession, saveSession } = storage;

  async function postCheckpoint(ctx, groupId, activeType, session, kind) {
    ensureCheckpointState(session);

    const checkpointId = session.nextCheckpointId;
    const promptText = kind === 'start'
      ? TEXT.checkpointStartPrompt(session.name)
      : TEXT.checkpointReminderPrompt(session.name, checkpointId);

    const sent = await ctx.replyWithMarkdown(promptText, checkpointKeyboard(kind, checkpointId));

    session.checkpoints.push({
      id: checkpointId,
      kind,
      createdAt: new Date().toISOString(),
      messageId: sent.message_id,
      confirmations: {},
    });
    session.nextCheckpointId += 1;

    if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
    if (!session.actionMessageIds.includes(sent.message_id)) {
      session.actionMessageIds.push(sent.message_id);
    }

    await saveSession(groupId, activeType, session);
    return checkpointId;
  }

  async function sendCheckpoint(ctx, kind) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(getSession, groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);

    const session = await getSession(groupId, activeType);
    const checkpointId = await postCheckpoint(ctx, groupId, activeType, session, kind);
    const label = kind === 'start' ? TEXT.checkpointLabelStart : TEXT.checkpointLabelReminder;
    return replyEphemeral(ctx, TEXT.checkpointPosted(label, checkpointId));
  }

  async function lessonstart(ctx) {
    return sendCheckpoint(ctx, 'start');
  }

  async function startless(ctx) {
    return sendCheckpoint(ctx, 'start');
  }

  async function lessonreminder(ctx) {
    return sendCheckpoint(ctx, 'reminder');
  }

  async function onMessage(ctx, next) {
    if (!ctx.message?.video_chat_started) return next();
    const chatType = ctx.chat?.type;
    if (chatType !== 'group' && chatType !== 'supergroup') return next();

    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(getSession, groupId);
    if (activeType !== 'main') return next();

    const session = await getSession(groupId, activeType);
    if (!session?.active) return next();

    ensureCheckpointState(session);
    const alreadyStarted = session.checkpoints.some((checkpoint) => checkpoint?.kind === 'start');
    if (alreadyStarted) return next();

    await postCheckpoint(ctx, groupId, activeType, session, 'start');
    return next();
  }

  return { lessonstart, startless, lessonreminder, onMessage };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.command('lessonstart', h.lessonstart);
  bot.command('startless', h.startless);
  bot.command('lessonreminder', h.lessonreminder);
  bot.on('message', h.onMessage);
}

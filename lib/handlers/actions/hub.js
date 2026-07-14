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
import { groupIdFromCtx, replyEphemeral, logTelegramError } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb } from '../../widgets.js';
import { pendingStudentsText, pendingStudentsKb } from './members.js';
import { historyHomeKb } from './history.js';
import { sessionsInSeries } from '../../historyUtils.js';

const HUB = TEXT.manageHub;

// The hub panel itself. Members/pending/history buttons carry the group id;
// the offline button reuses the existing user-owned `o:root` entry.
function hubView(groupId) {
  return {
    text: HUB.title,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback(HUB.membersButton, `mg:members:${groupId}`)],
      [Markup.button.callback(HUB.pendingButton, `mg:pending:${groupId}`)],
      [Markup.button.callback(HUB.historyButton, `mg:history:${groupId}`)],
      [Markup.button.callback(HUB.offlineButton, 'o:root')],
      [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')],
    ]),
  };
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
  const { getMaster, getPendingRegistrations, getAllSessions, getCurrentSeries } = storage;

  // Hub actions are delivered to the admin's DM, so each callback encodes the
  // real group id as ctx.match[1]; gate on membership of that group.
  const ensureAdmin = (ctx) => isAdminOf(telegram, ctx.match[1], ctx.from.id);

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

  return { manage, home, openMembers, openPending, openHistory };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('manage', h.manage);
  bot.action(/^mg:home:(-?\d+)$/, h.home);
  bot.action(/^mg:members:(-?\d+)$/, h.openMembers);
  bot.action(/^mg:pending:(-?\d+)$/, h.openPending);
  bot.action(/^mg:history:(-?\d+)$/, h.openHistory);
}

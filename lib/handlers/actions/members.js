import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic, ensureNoPendingAwaiting } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget, dismissKb } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getSession, saveSession, setAwaiting, getAwaiting } = storage;

  bot.action(/^mb:pick:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      { parse_mode: 'Markdown', ...memberOptionsKb(i) }
    );
    ctx.answerCbQuery();
  });

  bot.action(/^mb:del:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    master.members.splice(master.members.findIndex(m => m.name === name), 1);
    await saveMaster(groupId, master);

    const session = await getSession(groupId);
    if (session) {
      delete session.attendance[name];
      if (session.called) delete session.called[name];
      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, session));
    }

    await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    ctx.answerCbQuery(TEXT.memberDeletedShort(name));
  });

  bot.action(/^mb:ren:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.renamePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
    });
    await setAwaiting(groupId, uid, {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });

  bot.action('mb:back', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    ctx.answerCbQuery();
  });

  bot.action('mb:add', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.replyWithMarkdown(TEXT.inlinePromptAdd, dismissKb());
    await setAwaiting(groupId, uid, {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });
}

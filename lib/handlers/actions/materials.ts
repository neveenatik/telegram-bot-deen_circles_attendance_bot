// Teaching materials — the project's first TypeScript module.
//
// Admins/operators upload files (documents, photos, videos, audio) for a class.
// We persist only Telegram's file_id (Telegram hosts the bytes) plus a title,
// then reuse that file_id to resend the file on demand:
//   • group /manage hub  → push the material into the class group (live)
//   • offline class hub   → resend the material to the uploader's own chat
//
// Uploads reuse the existing force-reply routing (reply_prompts), but text.js's
// onText only fires for text messages, so files are captured by a sibling media
// handler (onMedia) registered on bot.on(['document','photo','video','audio']).
import { Markup } from 'telegraf';
import type { Context, Telegram } from 'telegraf';
import { TEXT } from '../../text.js';
import { beginForceReplyAwaiting, replyEphemeral, logTelegramError } from '../../helpers.js';
import { isAdminOf } from '../../guards.js';
import { clampButtonLabel } from '../../historyUtils.js';

const MAT = TEXT.materials;

type Surface = 'offline' | 'group';
type FileType = 'document' | 'photo' | 'video' | 'audio';

interface Material {
  id: number;
  title: string;
  fileId: string;
  fileType: FileType;
  fileName: string | null;
  addedBy: string | null;
  createdAt: string | null;
}

interface NewMaterial {
  title: string;
  fileId: string;
  fileType: FileType;
  fileName: string | null;
  addedBy: string | null;
}

interface ManageableClass {
  groupId: string;
  rowId: string | number;
  role: string;
  name: string;
  displayName?: string | null;
}

interface ReplyPromptRecord {
  action?: string;
  surface?: Surface;
  groupId?: string;
  gref?: string;
  chatId?: number | string;
  msgId?: number;
  [key: string]: unknown;
}

interface Storage {
  getReplyPrompt(chatId: string, promptMsgId: number): Promise<ReplyPromptRecord | null>;
  delReplyPrompt(chatId: string, promptMsgId: number): Promise<void>;
  setReplyPrompt(chatId: string, promptMsgId: number, record: Record<string, unknown>): Promise<void>;
  getMaterials(groupId: string): Promise<Material[]>;
  getMaterialById(groupId: string, id: string): Promise<Material | null>;
  addMaterial(groupId: string, material: NewMaterial): Promise<number | null>;
  removeMaterial(groupId: string, id: string): Promise<void>;
  resolveManageableClass(gref: string, userId: number | string): Promise<ManageableClass | null>;
}

type Handler = (ctx: Context, next: () => Promise<void>) => unknown;

interface BotLike {
  telegram: Telegram;
  on(updateType: string | string[], handler: Handler): unknown;
  action(trigger: RegExp | string, handler: Handler): unknown;
}

// The subset of an incoming Telegram message we read when capturing an upload.
interface UploadedMessage {
  message_id: number;
  reply_to_message?: { message_id: number };
  caption?: string;
  document?: { file_id: string; file_name?: string };
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string; file_name?: string };
  audio?: { file_id: string; file_name?: string };
}

// Only owners and operators manage materials (assistants get attendance +
// reports only, mirroring capsFor() in offline.js).
function canManageMaterials(role: string): boolean {
  return role === 'owner' || role === 'operator';
}

function readMatch(ctx: Context): RegExpExecArray {
  const m = (ctx as unknown as { match?: RegExpExecArray }).match;
  return m ?? ([] as unknown as RegExpExecArray);
}

function extractFile(msg: UploadedMessage): { fileId: string; fileType: FileType; fileName: string | null } | null {
  if (msg.document) {
    return { fileId: msg.document.file_id, fileType: 'document', fileName: msg.document.file_name ?? null };
  }
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    // Telegram sends multiple sizes ascending; the last is the highest quality.
    const largest = msg.photo[msg.photo.length - 1];
    if (largest) return { fileId: largest.file_id, fileType: 'photo', fileName: null };
  }
  if (msg.video) {
    return { fileId: msg.video.file_id, fileType: 'video', fileName: msg.video.file_name ?? null };
  }
  if (msg.audio) {
    return { fileId: msg.audio.file_id, fileType: 'audio', fileName: msg.audio.file_name ?? null };
  }
  return null;
}

// ── Pure renderers (surface-aware: offline tokens carry the numeric gref, group
// tokens carry the Telegram chat id) ─────────────────────────────────────────

function dismissRow() {
  return [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')];
}

function materialsListView(surface: Surface, token: string, materials: Material[]) {
  const list = Array.isArray(materials) ? materials : [];
  const addCb = surface === 'group' ? `mg:matadd:${token}` : `o:matadd:${token}`;
  const backCb = surface === 'group' ? `mg:home:${token}` : `o:cls:${token}`;
  const rows = [[Markup.button.callback(MAT.addButton, addCb)]];
  for (const m of list) {
    const itemCb = surface === 'group' ? `mg:matit:${token}:${m.id}` : `o:matit:${token}:${m.id}`;
    rows.push([Markup.button.callback(clampButtonLabel(m.title), itemCb)]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, backCb)]);
  rows.push(dismissRow());
  const hint = list.length ? MAT.manageHint : MAT.empty;
  return { text: `${MAT.title}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

function materialMenuView(surface: Surface, token: string, material: Material) {
  const id = material.id;
  const sendBtn = surface === 'group'
    ? Markup.button.callback(MAT.sendToGroupButton, `mg:matsend:${token}:${id}`)
    : Markup.button.callback(MAT.sendToMeButton, `o:matget:${token}:${id}`);
  const rmCb = surface === 'group' ? `mg:matrm:${token}:${id}` : `o:matrm:${token}:${id}`;
  const backCb = surface === 'group' ? `mg:mat:${token}` : `o:mat:${token}`;
  const rows = [
    [sendBtn],
    [Markup.button.callback(MAT.removeButton, rmCb)],
    [Markup.button.callback(TEXT.backButton, backCb)],
    dismissRow(),
  ];
  return { text: MAT.itemMenuTitle(material.title), keyboard: Markup.inlineKeyboard(rows) };
}

function materialRemoveConfirmView(surface: Surface, token: string, material: Material) {
  const id = material.id;
  const rmxCb = surface === 'group' ? `mg:matrmx:${token}:${id}` : `o:matrmx:${token}:${id}`;
  const backCb = surface === 'group' ? `mg:matit:${token}:${id}` : `o:matit:${token}:${id}`;
  const rows = [
    [Markup.button.callback(MAT.confirmRemoveButton, rmxCb)],
    [Markup.button.callback(TEXT.backButton, backCb)],
    dismissRow(),
  ];
  return { text: MAT.removeConfirm(material.title), keyboard: Markup.inlineKeyboard(rows) };
}

export function createHandlers({ storage, telegram }: { storage: Storage; telegram: Telegram }) {
  const {
    getReplyPrompt,
    delReplyPrompt,
    setReplyPrompt,
    getMaterials,
    getMaterialById,
    addMaterial,
    removeMaterial,
    resolveManageableClass,
  } = storage;

  // Resend a stored material by file_id, dispatching on its type.
  async function sendMaterial(chatId: string | number, material: Material): Promise<void> {
    const extra = { caption: MAT.caption(material.title), parse_mode: 'Markdown' as const };
    switch (material.fileType) {
      case 'document':
        await telegram.sendDocument(chatId, material.fileId, extra);
        return;
      case 'photo':
        await telegram.sendPhoto(chatId, material.fileId, extra);
        return;
      case 'video':
        await telegram.sendVideo(chatId, material.fileId, extra);
        return;
      case 'audio':
        await telegram.sendAudio(chatId, material.fileId, extra);
        return;
    }
  }

  // ── Offline class surface (o:mat*) ─────────────────────────────────────────
  // Tokens carry the numeric gref; resolveManageableClass gates on owner/operator.

  async function resolveOffline(ctx: Context): Promise<ManageableClass | null> {
    const gref = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (!gref || userId === undefined) return null;
    const cls = await resolveManageableClass(gref, userId);
    if (!cls || !canManageMaterials(cls.role)) return null;
    return cls;
  }

  async function materialsOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const list = await getMaterials(cls.groupId);
    const view = materialsListView('offline', String(cls.rowId), list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialAddOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: cls.groupId,
      record: { action: 'materialUpload', surface: 'offline', gref: String(cls.rowId) },
      sendPrompt: () => ctx.reply(MAT.addPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function materialItemOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialMenuView('offline', String(cls.rowId), material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialGetOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    try {
      await sendMaterial(userId, material);
      await ctx.answerCbQuery(MAT.sentToMe);
    } catch (err) {
      logTelegramError('materials.get.offline', err, { gref: String(cls.rowId), materialId: id });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
  }

  async function materialRemoveOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialRemoveConfirmView('offline', String(cls.rowId), material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialRemoveExecOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    await removeMaterial(cls.groupId, id);
    const list = await getMaterials(cls.groupId);
    const view = materialsListView('offline', String(cls.rowId), list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(material ? MAT.removedToast(material.title) : undefined);
  }

  // ── Group /manage surface (mg:mat*) ────────────────────────────────────────
  // Tokens carry the Telegram chat id; isAdminOf gates against that group.

  async function authorizeGroup(ctx: Context): Promise<string | null> {
    const groupId = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (!groupId || userId === undefined) return null;
    const ok = await isAdminOf(telegram, groupId, userId);
    return ok ? groupId : null;
  }

  async function materialsGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const list = await getMaterials(groupId);
    const view = materialsListView('group', groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialAddGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'materialUpload', surface: 'group' },
      sendPrompt: () => ctx.reply(MAT.addPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function materialItemGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialMenuView('group', groupId, material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialSendGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    try {
      await sendMaterial(groupId, material);
      await ctx.answerCbQuery(MAT.sentToGroup);
    } catch (err) {
      logTelegramError('materials.send.group', err, { groupId, materialId: id });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
  }

  async function materialRemoveGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialRemoveConfirmView('group', groupId, material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialRemoveExecGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    await removeMaterial(groupId, id);
    const list = await getMaterials(groupId);
    const view = materialsListView('group', groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(material ? MAT.removedToast(material.title) : undefined);
  }

  // ── Media capture: a file replying to an "add material" prompt ─────────────

  async function onMedia(ctx: Context, next: () => Promise<void>): Promise<void> {
    const msg = ctx.message as UploadedMessage | undefined;
    const promptMsgId = msg?.reply_to_message?.message_id;
    if (!msg || !promptMsgId || !ctx.chat) return next();

    const chatKey = String(ctx.chat.id);
    const pending = await getReplyPrompt(chatKey, promptMsgId);
    if (!pending || pending.action !== 'materialUpload' || !pending.groupId) return next();

    const file = extractFile(msg);
    if (!file) {
      // Keep the prompt open so she can reply again with a supported file.
      await replyEphemeral(ctx, MAT.unsupportedType);
      return;
    }

    const title = (msg.caption ?? '').trim();
    if (!title) {
      // Keep the prompt open so she can resend with a caption.
      await replyEphemeral(ctx, MAT.noCaption);
      return;
    }

    await delReplyPrompt(chatKey, promptMsgId);
    await addMaterial(pending.groupId, {
      title,
      fileId: file.fileId,
      fileType: file.fileType,
      fileName: file.fileName,
      addedBy: ctx.from ? String(ctx.from.id) : null,
    });
    await replyEphemeral(ctx, MAT.added(title), { parse_mode: 'Markdown' });

    // Refresh the originating panel back to the (now longer) materials list.
    if (pending.chatId === undefined || pending.msgId === undefined) return;
    const surface: Surface = pending.surface === 'group' ? 'group' : 'offline';
    const token = surface === 'group' ? String(pending.groupId) : String(pending.gref ?? '');
    const list = await getMaterials(pending.groupId);
    const view = materialsListView(surface, token, list);
    try {
      await telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        view.text,
        { parse_mode: 'Markdown', ...view.keyboard },
      );
    } catch (err) {
      logTelegramError('materials.upload.refreshPanel', err, {
        surface, chatId: String(pending.chatId), messageId: pending.msgId,
      });
    }
  }

  return {
    onMedia,
    materialsOffline,
    materialAddOffline,
    materialItemOffline,
    materialGetOffline,
    materialRemoveOffline,
    materialRemoveExecOffline,
    materialsGroup,
    materialAddGroup,
    materialItemGroup,
    materialSendGroup,
    materialRemoveGroup,
    materialRemoveExecGroup,
  };
}

export function register(bot: BotLike, storage: Storage): void {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on(['document', 'photo', 'video', 'audio'], h.onMedia);

  // Offline class surface (numeric gref token).
  bot.action(/^o:mat:(\d+)$/, h.materialsOffline);
  bot.action(/^o:matadd:(\d+)$/, h.materialAddOffline);
  bot.action(/^o:matit:(\d+):(\d+)$/, h.materialItemOffline);
  bot.action(/^o:matget:(\d+):(\d+)$/, h.materialGetOffline);
  bot.action(/^o:matrm:(\d+):(\d+)$/, h.materialRemoveOffline);
  bot.action(/^o:matrmx:(\d+):(\d+)$/, h.materialRemoveExecOffline);

  // Group /manage surface (Telegram chat id token, may be negative).
  bot.action(/^mg:mat:(-?\d+)$/, h.materialsGroup);
  bot.action(/^mg:matadd:(-?\d+)$/, h.materialAddGroup);
  bot.action(/^mg:matit:(-?\d+):(\d+)$/, h.materialItemGroup);
  bot.action(/^mg:matsend:(-?\d+):(\d+)$/, h.materialSendGroup);
  bot.action(/^mg:matrm:(-?\d+):(\d+)$/, h.materialRemoveGroup);
  bot.action(/^mg:matrmx:(-?\d+):(\d+)$/, h.materialRemoveExecGroup);
}

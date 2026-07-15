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

interface NewMaterialFile {
  fileId: string;
  fileType: FileType;
  fileName: string | null;
}

interface MaterialFile extends NewMaterialFile {
  id: number;
  position: number;
}

interface NewMaterial {
  title: string;
  addedBy: string | null;
}

interface Material extends NewMaterial {
  id: number;
  createdAt: string | null;
  files: MaterialFile[];
  fileCount: number;
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
  // Upload-session state: the lesson being filled (null until the first file
  // creates it), its title, and how many files have been added so far.
  materialId?: number | null;
  title?: string | null;
  count?: number;
  chatId?: number | string;
  msgId?: number;
  promptMsgId?: number;
  [key: string]: unknown;
}

interface Storage {
  getReplyPrompt(chatId: string, promptMsgId: number): Promise<ReplyPromptRecord | null>;
  getActiveReplyPrompt(chatId: string, action: string): Promise<ReplyPromptRecord | null>;
  delReplyPrompt(chatId: string, promptMsgId: number): Promise<void>;
  setReplyPrompt(chatId: string, promptMsgId: number, record: Record<string, unknown>): Promise<void>;
  getMaterials(groupId: string): Promise<Material[]>;
  getMaterialById(groupId: string, id: string): Promise<Material | null>;
  addMaterial(groupId: string, material: NewMaterial): Promise<number | null>;
  addMaterialFile(materialId: number, file: NewMaterialFile): Promise<number | null>;
  removeMaterial(groupId: string, id: string): Promise<void>;
  removeMaterialFile(groupId: string, materialId: number | string, fileId: number | string): Promise<void>;
  renameMaterial(groupId: string, id: string, title: string): Promise<void>;
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
    const label = `${m.title} · ${MAT.fileCountLabel(m.fileCount)}`;
    rows.push([Markup.button.callback(clampButtonLabel(label), itemCb)]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, backCb)]);
  rows.push(dismissRow());
  const hint = list.length ? MAT.manageHint : MAT.empty;
  return { text: `${MAT.title}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

export function materialMenuView(surface: Surface, token: string, material: Material) {
  const id = material.id;
  const sendBtn = surface === 'group'
    ? Markup.button.callback(MAT.sendToGroupButton, `mg:matsend:${token}:${id}`)
    : Markup.button.callback(MAT.sendToMeButton, `o:matget:${token}:${id}`);
  const selectCb = surface === 'group' ? `mg:matsel:${token}:${id}` : `o:matsel:${token}:${id}`;
  const addFileCb = surface === 'group' ? `mg:matfadd:${token}:${id}` : `o:matfadd:${token}:${id}`;
  const renameCb = surface === 'group' ? `mg:matren:${token}:${id}` : `o:matren:${token}:${id}`;
  const rmCb = surface === 'group' ? `mg:matrm:${token}:${id}` : `o:matrm:${token}:${id}`;
  const backCb = surface === 'group' ? `mg:mat:${token}` : `o:mat:${token}`;
  const rows = [
    [sendBtn],
  ];
  // Offer a per-file picker only when there is more than one file to choose from.
  if (material.fileCount > 1) rows.push([Markup.button.callback(MAT.selectButton, selectCb)]);
  // Per-file management (preview / delete a single file) once there is >1 file.
  const filesCb = surface === 'group' ? `mg:matfiles:${token}:${id}` : `o:matfiles:${token}:${id}`;
  if (material.fileCount > 1) rows.push([Markup.button.callback(MAT.manageFilesButton, filesCb)]);
  rows.push(
    [Markup.button.callback(MAT.addFileButton, addFileCb)],
    [Markup.button.callback(MAT.renameButton, renameCb)],
    [Markup.button.callback(MAT.removeButton, rmCb)],
    [Markup.button.callback(TEXT.backButton, backCb)],
    dismissRow(),
  );
  return { text: MAT.itemMenuTitle(material.title, material.fileCount), keyboard: Markup.inlineKeyboard(rows) };
}

// Per-file picker. Selection is stateless: the set of chosen files is encoded as
// a bitmask in the callback data (bit i = file at index i). Tapping a file flips
// its bit and re-renders; Send delivers only the checked files.
const TYPE_ICON: Record<FileType, string> = {
  document: '📄', photo: '🖼️', video: '🎬', audio: '🎵',
};

function materialSelectView(surface: Surface, token: string, material: Material, mask: number) {
  const id = material.id;
  const togBase = surface === 'group' ? `mg:matseltog:${token}:${id}` : `o:matseltog:${token}:${id}`;
  const sendCb = surface === 'group' ? `mg:matselsend:${token}:${id}:${mask}` : `o:matselsend:${token}:${id}:${mask}`;
  const backCb = surface === 'group' ? `mg:matit:${token}:${id}` : `o:matit:${token}:${id}`;
  const rows = material.files.map((f, i) => {
    const checked = (mask >> i) & 1;
    const name = f.fileName || MAT.fileFallback(i + 1);
    const label = `${checked ? '☑️' : '⬜️'} ${TYPE_ICON[f.fileType]} ${name}`;
    return [Markup.button.callback(clampButtonLabel(label), `${togBase}:${i}:${mask}`)];
  });
  rows.push([Markup.button.callback(MAT.sendSelectedButton, sendCb)]);
  rows.push([Markup.button.callback(TEXT.backButton, backCb)]);
  rows.push(dismissRow());
  return { text: `${MAT.selectTitle(material.title)}\n\n${MAT.selectHint}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Shown on the panel while an upload session is active. The Done button carries
// the live force-reply prompt's message id so tapping it closes that prompt.
function materialSessionView(surface: Surface, token: string, count: number, promptMsgId: number, title: string | null) {
  const doneCb = surface === 'group'
    ? `mg:matdone:${token}:${promptMsgId}`
    : `o:matdone:${token}:${promptMsgId}`;
  const heading = title ? MAT.sessionTitle(title) : MAT.title;
  const rows = [
    [Markup.button.callback(MAT.doneButton, doneCb)],
    dismissRow(),
  ];
  return { text: `${heading}\n\n${MAT.sessionCount(count)}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Per-file management: each file is a row with a preview button (its name;
// tapping resends just that file) and a trash button (opens a delete confirm).
function materialFilesView(surface: Surface, token: string, material: Material) {
  const id = material.id;
  const prevBase = surface === 'group' ? `mg:matfprev:${token}:${id}` : `o:matfprev:${token}:${id}`;
  const rmBase = surface === 'group' ? `mg:matfrm:${token}:${id}` : `o:matfrm:${token}:${id}`;
  const backCb = surface === 'group' ? `mg:matit:${token}:${id}` : `o:matit:${token}:${id}`;
  const rows = material.files.map((f, i) => {
    const name = f.fileName || MAT.fileFallback(i + 1);
    const label = `${TYPE_ICON[f.fileType]} ${name}`;
    return [
      Markup.button.callback(clampButtonLabel(label), `${prevBase}:${f.id}`),
      Markup.button.callback(MAT.deleteFileButton, `${rmBase}:${f.id}`),
    ];
  });
  rows.push([Markup.button.callback(TEXT.backButton, backCb)]);
  rows.push(dismissRow());
  return { text: `${MAT.filesTitle(material.title)}\n\n${MAT.filesHint}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Confirm deleting a single file from a lesson.
function materialFileRemoveConfirmView(surface: Surface, token: string, material: Material, file: MaterialFile, index: number) {
  const id = material.id;
  const rmxCb = surface === 'group' ? `mg:matfrmx:${token}:${id}:${file.id}` : `o:matfrmx:${token}:${id}:${file.id}`;
  const backCb = surface === 'group' ? `mg:matfiles:${token}:${id}` : `o:matfiles:${token}:${id}`;
  const name = file.fileName || MAT.fileFallback(index + 1);
  const rows = [
    [Markup.button.callback(MAT.confirmRemoveFileButton, rmxCb)],
    [Markup.button.callback(TEXT.backButton, backCb)],
    dismissRow(),
  ];
  return { text: MAT.fileRemoveConfirm(name), keyboard: Markup.inlineKeyboard(rows) };
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
    getActiveReplyPrompt,
    getMaterials,
    getMaterialById,
    addMaterial,
    addMaterialFile,
    removeMaterial,
    removeMaterialFile,
    resolveManageableClass,
  } = storage;

  // Resend a list of files (in order) by file_id. The lesson title rides as the
  // caption on the first file only.
  async function sendFiles(chatId: string | number, title: string, files: MaterialFile[]): Promise<void> {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (!file) continue;
      const extra = i === 0
        ? { caption: MAT.caption(title), parse_mode: 'Markdown' as const }
        : {};
      switch (file.fileType) {
        case 'document':
          await telegram.sendDocument(chatId, file.fileId, extra);
          break;
        case 'photo':
          await telegram.sendPhoto(chatId, file.fileId, extra);
          break;
        case 'video':
          await telegram.sendVideo(chatId, file.fileId, extra);
          break;
        case 'audio':
          await telegram.sendAudio(chatId, file.fileId, extra);
          break;
      }
    }
  }

  // Resend a whole lesson (all files).
  async function sendMaterial(chatId: string | number, material: Material): Promise<void> {
    await sendFiles(chatId, material.title, Array.isArray(material.files) ? material.files : []);
  }

  // Files of a lesson whose index bit is set in the selection mask, in order.
  function selectedFiles(material: Material, mask: number): MaterialFile[] {
    return material.files.filter((_, i) => (mask >> i) & 1);
  }

  // Open an upload session: send a fresh force-reply prompt and switch the panel
  // to the session view (with a Done button pointing at that prompt). Files the
  // admin replies with are captured by onMedia, which re-arms the next prompt.
  async function beginUploadSession(
    ctx: Context,
    opts: { surface: Surface; token: string; groupId: string; gref?: string; materialId: number | null; title: string | null; count: number; promptText: string },
  ): Promise<void> {
    const prompt = await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: opts.groupId,
      record: {
        action: 'materialUpload',
        surface: opts.surface,
        gref: opts.gref,
        materialId: opts.materialId,
        title: opts.title,
        count: opts.count,
      },
      sendPrompt: () => ctx.reply(opts.promptText, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
    const view = materialSessionView(opts.surface, opts.token, opts.count, prompt.message_id, opts.title);
    try {
      await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    } catch (err) {
      logTelegramError('materials.session.begin', err, { surface: opts.surface, token: opts.token });
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
    await beginUploadSession(ctx, {
      surface: 'offline',
      token: String(cls.rowId),
      groupId: cls.groupId,
      gref: String(cls.rowId),
      materialId: null,
      title: null,
      count: 0,
      promptText: MAT.addPrompt,
    });
  }

  // Option 3: add more files to an existing lesson (title already set).
  async function materialFileAddOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    await beginUploadSession(ctx, {
      surface: 'offline',
      token: String(cls.rowId),
      groupId: cls.groupId,
      gref: String(cls.rowId),
      materialId: material.id,
      title: material.title,
      count: material.fileCount,
      promptText: MAT.addFilePrompt,
    });
  }

  async function materialDoneOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const promptMsgId = Number(readMatch(ctx)[2] ?? 0);
    if (promptMsgId && ctx.chat) await delReplyPrompt(String(ctx.chat.id), promptMsgId);
    const list = await getMaterials(cls.groupId);
    const view = materialsListView('offline', String(cls.rowId), list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  // Rename a lesson: the new title arrives as a text reply routed by text.js
  // (action 'materialRename'), which rewrites the item menu.
  async function materialRenameOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: cls.groupId,
      record: { action: 'materialRename', surface: 'offline', token: String(cls.rowId), materialId: material.id },
      sendPrompt: () => ctx.reply(MAT.renamePrompt(material.title), { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  // Per-file picker (offline): open with everything selected, toggle, then send
  // only the checked files to the uploader's own chat.
  async function materialSelectOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
    const mask = (1 << material.fileCount) - 1;
    const view = materialSelectView('offline', String(cls.rowId), material, mask);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialSelectToggleOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const idx = Number(m[3] ?? 0);
    const mask = Number(m[4] ?? 0) ^ (1 << idx);
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialSelectView('offline', String(cls.rowId), material, mask);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialSelectSendOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const mask = Number(m[3] ?? 0);
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const files = selectedFiles(material, mask);
    if (!files.length) { await ctx.answerCbQuery(MAT.selectNone); return; }
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    try {
      await sendFiles(userId, material.title, files);
      await ctx.answerCbQuery(MAT.sentSelected(files.length));
    } catch (err) {
      logTelegramError('materials.select.send.offline', err, { gref: String(cls.rowId), materialId: id });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
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
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
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

  // ── Per-file management (offline): preview or delete a single file ─────────

  async function materialFilesOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
    const view = materialFilesView('offline', String(cls.rowId), material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialFilePreviewOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const file = material.files.find((f) => f.id === fileId);
    if (!file) { await ctx.answerCbQuery(MAT.fileMissing); return; }
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (chatId === undefined) return;
    try {
      await sendFiles(chatId, material.title, [file]);
      await ctx.answerCbQuery(MAT.previewSent);
    } catch (err) {
      logTelegramError('materials.file.preview.offline', err, { gref: String(cls.rowId), materialId: id, fileId });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
  }

  async function materialFileRemoveOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (material.fileCount <= 1) { await ctx.answerCbQuery(MAT.cannotDeleteLastFile); return; }
    const index = material.files.findIndex((f) => f.id === fileId);
    const file = material.files[index];
    if (!file) { await ctx.answerCbQuery(MAT.fileMissing); return; }
    const view = materialFileRemoveConfirmView('offline', String(cls.rowId), material, file, index);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialFileRemoveExecOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(cls.groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (material.fileCount <= 1) { await ctx.answerCbQuery(MAT.cannotDeleteLastFile); return; }
    await removeMaterialFile(cls.groupId, material.id, fileId);
    const updated = await getMaterialById(cls.groupId, id);
    const view = updated && updated.fileCount > 1
      ? materialFilesView('offline', String(cls.rowId), updated)
      : materialMenuView('offline', String(cls.rowId), updated ?? material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(MAT.fileRemovedToast);
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
    await beginUploadSession(ctx, {
      surface: 'group',
      token: groupId,
      groupId,
      materialId: null,
      title: null,
      count: 0,
      promptText: MAT.addPrompt,
    });
  }

  // Option 3: add more files to an existing lesson (title already set).
  async function materialFileAddGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    await beginUploadSession(ctx, {
      surface: 'group',
      token: groupId,
      groupId,
      materialId: material.id,
      title: material.title,
      count: material.fileCount,
      promptText: MAT.addFilePrompt,
    });
  }

  async function materialDoneGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const promptMsgId = Number(readMatch(ctx)[2] ?? 0);
    if (promptMsgId && ctx.chat) await delReplyPrompt(String(ctx.chat.id), promptMsgId);
    const list = await getMaterials(groupId);
    const view = materialsListView('group', groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialRenameGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId,
      record: { action: 'materialRename', surface: 'group', token: groupId, materialId: material.id },
      sendPrompt: () => ctx.reply(MAT.renamePrompt(material.title), { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  // Per-file picker (group): send only the checked files into the group chat.
  async function materialSelectGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
    const mask = (1 << material.fileCount) - 1;
    const view = materialSelectView('group', groupId, material, mask);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialSelectToggleGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const idx = Number(m[3] ?? 0);
    const mask = Number(m[4] ?? 0) ^ (1 << idx);
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const view = materialSelectView('group', groupId, material, mask);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialSelectSendGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const mask = Number(m[3] ?? 0);
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const files = selectedFiles(material, mask);
    if (!files.length) { await ctx.answerCbQuery(MAT.selectNone); return; }
    try {
      await sendFiles(groupId, material.title, files);
      await ctx.answerCbQuery(MAT.sentSelected(files.length));
    } catch (err) {
      logTelegramError('materials.select.send.group', err, { groupId, materialId: id });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
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
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
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

  // ── Per-file management (group): preview or delete a single file ───────────

  async function materialFilesGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (!material.fileCount) { await ctx.answerCbQuery(MAT.noFiles); return; }
    const view = materialFilesView('group', groupId, material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialFilePreviewGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    const file = material.files.find((f) => f.id === fileId);
    if (!file) { await ctx.answerCbQuery(MAT.fileMissing); return; }
    const chatId = ctx.chat?.id ?? groupId;
    try {
      await sendFiles(chatId, material.title, [file]);
      await ctx.answerCbQuery(MAT.previewSent);
    } catch (err) {
      logTelegramError('materials.file.preview.group', err, { groupId, materialId: id, fileId });
      await ctx.answerCbQuery(MAT.sendFailed);
    }
  }

  async function materialFileRemoveGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (material.fileCount <= 1) { await ctx.answerCbQuery(MAT.cannotDeleteLastFile); return; }
    const index = material.files.findIndex((f) => f.id === fileId);
    const file = material.files[index];
    if (!file) { await ctx.answerCbQuery(MAT.fileMissing); return; }
    const view = materialFileRemoveConfirmView('group', groupId, material, file, index);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function materialFileRemoveExecGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const id = m[2] ?? '';
    const fileId = Number(m[3] ?? 0);
    const material = await getMaterialById(groupId, id);
    if (!material) { await ctx.answerCbQuery(MAT.missing); return; }
    if (material.fileCount <= 1) { await ctx.answerCbQuery(MAT.cannotDeleteLastFile); return; }
    await removeMaterialFile(groupId, material.id, fileId);
    const updated = await getMaterialById(groupId, id);
    const view = updated && updated.fileCount > 1
      ? materialFilesView('group', groupId, updated)
      : materialMenuView('group', groupId, updated ?? material);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(MAT.fileRemovedToast);
  }

  // ── Media capture: files added to an active upload session ─────────────────
  //
  // A single force-reply prompt opens the session; the panel then shows a
  // running count + Done. Files are captured whether or not they reply to the
  // prompt, so sending several at once (an album — where only the first item
  // carries reply_to) appends every file, not just one. The first file of a NEW
  // lesson sets its title (its caption, or the attachment filename); every
  // file's caption also names that file. Done closes the session.

  async function onMedia(ctx: Context, next: () => Promise<void>): Promise<void> {
    const msg = ctx.message as UploadedMessage | undefined;
    if (!msg || !ctx.chat) return next();
    const chatKey = String(ctx.chat.id);

    // Prefer the replied-to prompt; fall back to the newest active session so
    // album items without a reply still land in the same lesson.
    let pending: ReplyPromptRecord | null = null;
    const replyId = msg.reply_to_message?.message_id;
    if (replyId) pending = await getReplyPrompt(chatKey, replyId);
    if (!pending || pending.action !== 'materialUpload') {
      pending = await getActiveReplyPrompt(chatKey, 'materialUpload');
    }
    if (!pending || pending.action !== 'materialUpload' || !pending.groupId) return next();

    const file = extractFile(msg);
    if (!file) {
      // Keep the session open so she can send a supported file.
      await replyEphemeral(ctx, MAT.unsupportedType);
      return;
    }

    const promptMsgId = Number(pending.promptMsgId ?? replyId);
    const groupId = pending.groupId;
    let materialId = pending.materialId ?? null;
    let title = pending.title ?? null;
    let count = pending.count ?? 0;
    // The caption typed on this file names the file itself (falling back to the
    // attachment's own filename). On the first file it doubles as the lesson title.
    const caption = (msg.caption ?? '').trim();

    if (!materialId) {
      // First file of a new lesson: its caption (or filename) is the title.
      title = caption || file.fileName || null;
      if (!title) {
        await replyEphemeral(ctx, MAT.noCaption);
        return;
      }
      materialId = await addMaterial(groupId, {
        title,
        addedBy: ctx.from ? String(ctx.from.id) : null,
      });
      if (!materialId) {
        await delReplyPrompt(chatKey, promptMsgId);
        await replyEphemeral(ctx, MAT.sendFailed);
        return;
      }
    }

    await addMaterialFile(materialId, {
      fileId: file.fileId,
      fileType: file.fileType,
      fileName: caption || file.fileName,
    });
    count += 1;

    // Persist the session in place (no prompt rotation) so more files keep
    // appending until Done.
    await setReplyPrompt(chatKey, promptMsgId, {
      action: 'materialUpload',
      surface: pending.surface,
      gref: pending.gref,
      groupId,
      materialId,
      title,
      count,
      userId: pending.userId,
      chatId: pending.chatId,
      msgId: pending.msgId,
    });

    // Refresh the originating panel to the session view (running count + Done).
    if (pending.chatId === undefined || pending.msgId === undefined) return;
    const surface: Surface = pending.surface === 'group' ? 'group' : 'offline';
    const token = surface === 'group' ? String(groupId) : String(pending.gref ?? '');
    const view = materialSessionView(surface, token, count, promptMsgId, title);
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
    materialFileAddOffline,
    materialRenameOffline,
    materialSelectOffline,
    materialSelectToggleOffline,
    materialSelectSendOffline,
    materialDoneOffline,
    materialItemOffline,
    materialGetOffline,
    materialRemoveOffline,
    materialRemoveExecOffline,
    materialFilesOffline,
    materialFilePreviewOffline,
    materialFileRemoveOffline,
    materialFileRemoveExecOffline,
    materialsGroup,
    materialAddGroup,
    materialFileAddGroup,
    materialRenameGroup,
    materialSelectGroup,
    materialSelectToggleGroup,
    materialSelectSendGroup,
    materialDoneGroup,
    materialItemGroup,
    materialSendGroup,
    materialRemoveGroup,
    materialRemoveExecGroup,
    materialFilesGroup,
    materialFilePreviewGroup,
    materialFileRemoveGroup,
    materialFileRemoveExecGroup,
  };
}

export function register(bot: BotLike, storage: Storage): void {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on(['document', 'photo', 'video', 'audio'], h.onMedia);

  // Offline class surface (numeric gref token).
  bot.action(/^o:mat:(\d+)$/, h.materialsOffline);
  bot.action(/^o:matadd:(\d+)$/, h.materialAddOffline);
  bot.action(/^o:matfadd:(\d+):(\d+)$/, h.materialFileAddOffline);
  bot.action(/^o:matren:(\d+):(\d+)$/, h.materialRenameOffline);
  bot.action(/^o:matsel:(\d+):(\d+)$/, h.materialSelectOffline);
  bot.action(/^o:matseltog:(\d+):(\d+):(\d+):(\d+)$/, h.materialSelectToggleOffline);
  bot.action(/^o:matselsend:(\d+):(\d+):(\d+)$/, h.materialSelectSendOffline);
  bot.action(/^o:matdone:(\d+):(\d+)$/, h.materialDoneOffline);
  bot.action(/^o:matit:(\d+):(\d+)$/, h.materialItemOffline);
  bot.action(/^o:matget:(\d+):(\d+)$/, h.materialGetOffline);
  bot.action(/^o:matrm:(\d+):(\d+)$/, h.materialRemoveOffline);
  bot.action(/^o:matrmx:(\d+):(\d+)$/, h.materialRemoveExecOffline);
  bot.action(/^o:matfiles:(\d+):(\d+)$/, h.materialFilesOffline);
  bot.action(/^o:matfprev:(\d+):(\d+):(\d+)$/, h.materialFilePreviewOffline);
  bot.action(/^o:matfrm:(\d+):(\d+):(\d+)$/, h.materialFileRemoveOffline);
  bot.action(/^o:matfrmx:(\d+):(\d+):(\d+)$/, h.materialFileRemoveExecOffline);

  // Group /manage surface (Telegram chat id token, may be negative).
  bot.action(/^mg:mat:(-?\d+)$/, h.materialsGroup);
  bot.action(/^mg:matadd:(-?\d+)$/, h.materialAddGroup);
  bot.action(/^mg:matfadd:(-?\d+):(\d+)$/, h.materialFileAddGroup);
  bot.action(/^mg:matren:(-?\d+):(\d+)$/, h.materialRenameGroup);
  bot.action(/^mg:matsel:(-?\d+):(\d+)$/, h.materialSelectGroup);
  bot.action(/^mg:matseltog:(-?\d+):(\d+):(\d+):(\d+)$/, h.materialSelectToggleGroup);
  bot.action(/^mg:matselsend:(-?\d+):(\d+):(\d+)$/, h.materialSelectSendGroup);
  bot.action(/^mg:matdone:(-?\d+):(\d+)$/, h.materialDoneGroup);
  bot.action(/^mg:matit:(-?\d+):(\d+)$/, h.materialItemGroup);
  bot.action(/^mg:matsend:(-?\d+):(\d+)$/, h.materialSendGroup);
  bot.action(/^mg:matrm:(-?\d+):(\d+)$/, h.materialRemoveGroup);
  bot.action(/^mg:matrmx:(-?\d+):(\d+)$/, h.materialRemoveExecGroup);
  bot.action(/^mg:matfiles:(-?\d+):(\d+)$/, h.materialFilesGroup);
  bot.action(/^mg:matfprev:(-?\d+):(\d+):(\d+)$/, h.materialFilePreviewGroup);
  bot.action(/^mg:matfrm:(-?\d+):(\d+):(\d+)$/, h.materialFileRemoveGroup);
  bot.action(/^mg:matfrmx:(-?\d+):(\d+):(\d+)$/, h.materialFileRemoveExecGroup);
}

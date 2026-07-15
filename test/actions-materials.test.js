import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/materials.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const MAT = TEXT.materials;
const OWNER = 1001;

// Storage stub with the materials + class-resolution methods the handlers use.
// Defaults to an owner with one lesson holding a single document file.
function matStorage(overrides = {}) {
  return makeStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'owner', name: 'صف' }),
    getMaterials: async () => [
      {
        id: 1, title: 'مادة أولى', addedBy: null, createdAt: null,
        files: [{ id: 11, fileId: 'FID1', fileType: 'document', fileName: null, position: 1 }], fileCount: 1,
      },
    ],
    getMaterialById: async (_g, id) => ({
      id: Number(id), title: 'مادة أولى', addedBy: null, createdAt: null,
      files: [{ id: 11, fileId: 'FID1', fileType: 'document', fileName: null, position: 1 }], fileCount: 1,
    }),
    addMaterial: async () => 2,
    addMaterialFile: async () => 3,
    removeMaterial: async () => {},
    removeMaterialFile: async () => {},
    renameMaterial: async () => {},
    renameMaterialFile: async () => {},
    ...overrides,
  });
}

// A Telegram client that records sendDocument/Photo/Video/Audio calls.
function telegramWithSend(overrides = {}) {
  const sent = { sendDocument: [], sendPhoto: [], sendVideo: [], sendAudio: [] };
  const telegram = makeTelegram({
    sendDocument: (...a) => { sent.sendDocument.push(a); return Promise.resolve({ message_id: 1 }); },
    sendPhoto: (...a) => { sent.sendPhoto.push(a); return Promise.resolve({ message_id: 1 }); },
    sendVideo: (...a) => { sent.sendVideo.push(a); return Promise.resolve({ message_id: 1 }); },
    sendAudio: (...a) => { sent.sendAudio.push(a); return Promise.resolve({ message_id: 1 }); },
    ...overrides,
  });
  return { telegram, sent };
}

// A hand-built context for an incoming media reply (makeCtx only models text).
function mediaCtx({ chatId = 777, userId = OWNER, promptMsgId = 555, caption = 'عنوان', document = { file_id: 'FIDX', file_name: 'a.pdf' }, photo = null, reply = true } = {}) {
  const calls = { reply: [], answerCbQuery: [] };
  const message = { message_id: 900, caption };
  if (document) message.document = document;
  if (photo) message.photo = photo;
  if (reply) message.reply_to_message = { message_id: promptMsgId };
  const ctx = {
    chat: { id: chatId, type: 'private' },
    from: { id: userId, first_name: 'T' },
    message,
    telegram: makeTelegram(),
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 901, chat: { id: chatId } }); },
    answerCbQuery(...a) { calls.answerCbQuery.push(a); return Promise.resolve(true); },
  };
  return { ctx, calls };
}

function editData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

// ── Offline class surface ──────────────────────────────────────────────────

test('offline: owner sees the materials list with add + item + back', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:mat:5', '5'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialsOffline(ctx);

  const data = editData(calls);
  assert.ok(data.includes('o:matadd:5'));
  assert.ok(data.includes('o:matit:5:1'));
  assert.ok(data.includes('o:cls:5'));
});

test('offline: assistant is rejected (materials are owner/operator only)', async () => {
  const storage = matStorage({
    resolveManageableClass: async () => ({ groupId: 'offline:o:1', rowId: 5, role: 'assistant', name: 'صف' }),
  });
  const { ctx, calls, telegram } = makeCtx({ userId: 2002, match: ['o:mat:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.materialsOffline(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

test('offline: add prompt stores a materialUpload reply prompt', async () => {
  const prompts = [];
  const storage = matStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  const { ctx, telegram } = makeCtx({ userId: OWNER, match: ['o:matadd:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.materialAddOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.action, 'materialUpload');
  assert.equal(prompts[0].rec.surface, 'offline');
  assert.equal(prompts[0].rec.gref, '5');
  assert.equal(prompts[0].rec.groupId, 'offline:o:1');
});

test('offline: send-to-me resends the file by file_id to the uploader', async () => {
  const { telegram, sent } = telegramWithSend();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:matget:5:1', '5', '1'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialGetOffline(ctx);

  assert.equal(sent.sendDocument.length, 1);
  assert.equal(sent.sendDocument[0][0], OWNER);
  assert.equal(sent.sendDocument[0][1], 'FID1');
  assert.equal(calls.answerCbQuery[0][0], MAT.sentToMe);
});

test('offline: confirming removal deletes and re-renders the list', async () => {
  const removed = [];
  const storage = matStorage({
    removeMaterial: async (g, id) => { removed.push([g, id]); },
    getMaterials: async () => [],
  });
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matrmx:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialRemoveExecOffline(ctx);

  assert.deepEqual(removed, [['offline:o:1', '1']]);
  assert.ok(editData(calls).includes('o:matadd:5'));
  assert.equal(calls.answerCbQuery[0][0], MAT.removedToast('مادة أولى'));
});

// ── Per-file management (preview / delete a single file) ───────────────────

// A lesson holding two files, for exercising the per-file surface.
function twoFileStorage(overrides = {}) {
  return matStorage({
    getMaterialById: async (_g, id) => ({
      id: Number(id), title: 'مادة أولى', addedBy: null, createdAt: null,
      files: [
        { id: 11, fileId: 'FID1', fileType: 'document', fileName: 'أول.pdf', position: 1 },
        { id: 12, fileId: 'FID2', fileType: 'photo', fileName: null, position: 2 },
      ],
      fileCount: 2,
    }),
    ...overrides,
  });
}

test('offline: item menu offers manage-files when there is more than one file', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matit:5:1', '5', '1'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialItemOffline(ctx);

  assert.ok(editData(calls).includes('o:matfiles:5:1'));
});

test('offline: item menu hides manage-files for a single-file lesson', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matit:5:1', '5', '1'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialItemOffline(ctx);

  assert.ok(!editData(calls).includes('o:matfiles:5:1'));
});

test('offline: files view lists each file as a checkbox with preview/delete actions', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfiles:5:1', '5', '1'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFilesOffline(ctx);

  const data = editData(calls);
  // Opens with nothing selected (mask 0): each file is a toggle carrying its index.
  assert.ok(data.includes('o:matftog:5:1:0:0'));
  assert.ok(data.includes('o:matftog:5:1:1:0'));
  // Preview / delete act on the current selection mask (0 here).
  assert.ok(data.includes('o:matfprev:5:1:0'));
  assert.ok(data.includes('o:matfrm:5:1:0'));
});

test('offline: toggling a file flips its bit in the selection mask', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matftog:5:1:1:0', '5', '1', '1', '0'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFileToggleOffline(ctx);

  const data = editData(calls);
  // Bit 1 set → mask 2; actions now carry mask 2, and toggling file 1 again clears it.
  assert.ok(data.includes('o:matfprev:5:1:2'));
  assert.ok(data.includes('o:matfrm:5:1:2'));
  assert.ok(data.includes('o:matftog:5:1:1:2'));
});

test('offline: previewing resends the selected files to the admin', async () => {
  const { telegram, sent } = telegramWithSend();
  // Mask 2 → only file index 1 (the photo, id 12) is selected.
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:matfprev:5:1:2', '5', '1', '2'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFilePreviewOffline(ctx);

  assert.equal(sent.sendPhoto.length, 1);
  assert.equal(sent.sendPhoto[0][1], 'FID2');
  assert.equal(sent.sendDocument.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.previewSentMany(1));
});

test('offline: previewing with nothing selected warns and sends nothing', async () => {
  const { telegram, sent } = telegramWithSend();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:matfprev:5:1:0', '5', '1', '0'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFilePreviewOffline(ctx);

  assert.equal(sent.sendPhoto.length, 0);
  assert.equal(sent.sendDocument.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.selectNone);
});

test('offline: delete asks to confirm the selected files', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfrm:5:1:2', '5', '1', '2'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFileRemoveOffline(ctx);

  // Confirm button carries the same mask through to the exec step.
  assert.ok(editData(calls).includes('o:matfrmx:5:1:2'));
});

test('offline: confirming a delete removes only the selected files and re-renders', async () => {
  const removed = [];
  const storage = matStorage({
    removeMaterialFile: async (g, mid, fid) => { removed.push([g, mid, fid]); },
  });
  // First getMaterialById call (guard) returns two files; the refresh after
  // delete returns one file → falls back to the item menu.
  let call = 0;
  storage.getMaterialById = async (_g, id) => {
    call += 1;
    if (call === 1) {
      return {
        id: Number(id), title: 'مادة أولى', addedBy: null, createdAt: null,
        files: [
          { id: 11, fileId: 'FID1', fileType: 'document', fileName: 'أول.pdf', position: 1 },
          { id: 12, fileId: 'FID2', fileType: 'photo', fileName: null, position: 2 },
        ],
        fileCount: 2,
      };
    }
    return {
      id: Number(id), title: 'مادة أولى', addedBy: null, createdAt: null,
      files: [{ id: 11, fileId: 'FID1', fileType: 'document', fileName: 'أول.pdf', position: 1 }],
      fileCount: 1,
    };
  };
  // Mask 2 → delete only file index 1 (id 12).
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfrmx:5:1:2', '5', '1', '2'] });
  const h = createHandlers({ storage, telegram });

  await h.materialFileRemoveExecOffline(ctx);

  assert.deepEqual(removed, [['offline:o:1', 1, 12]]);
  assert.equal(calls.answerCbQuery[0][0], MAT.filesRemovedToast(1));
  // Only one file left → shows the item menu (not the files list).
  assert.ok(editData(calls).includes('o:matget:5:1'));
});

test('offline: refuses to delete every file at once', async () => {
  const removed = [];
  const storage = twoFileStorage({ removeMaterialFile: async (...a) => { removed.push(a); } });
  // Mask 3 → both files selected, which would empty the lesson.
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfrmx:5:1:3', '5', '1', '3'] });
  const h = createHandlers({ storage, telegram });

  await h.materialFileRemoveExecOffline(ctx);

  assert.equal(removed.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.cannotDeleteAllFiles);
});

// ── Per-file rename ─────────────────────────────────────────────────────────

test('offline: files view offers a rename-selected action', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfiles:5:1', '5', '1'] });
  const h = createHandlers({ storage: twoFileStorage(), telegram });

  await h.materialFilesOffline(ctx);

  assert.ok(editData(calls).includes('o:matfren:5:1:0'));
});

test('offline: renaming one selected file arms a materialFileRename prompt for that file', async () => {
  const prompts = [];
  const storage = twoFileStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  // Mask 2 → only file index 1 (the photo, id 12) is selected.
  const { ctx, telegram } = makeCtx({ userId: OWNER, match: ['o:matfren:5:1:2', '5', '1', '2'] });
  const h = createHandlers({ storage, telegram });

  await h.materialFileRenameOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.action, 'materialFileRename');
  assert.equal(prompts[0].rec.surface, 'offline');
  assert.equal(prompts[0].rec.token, '5');
  assert.equal(prompts[0].rec.materialId, 1);
  assert.equal(prompts[0].rec.fileId, 12);
});

test('offline: renaming refuses unless exactly one file is selected', async () => {
  const prompts = [];
  const storage = twoFileStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  // Mask 3 → two files selected; mask 0 → none. Neither may rename.
  const both = makeCtx({ userId: OWNER, match: ['o:matfren:5:1:3', '5', '1', '3'] });
  const none = makeCtx({ userId: OWNER, match: ['o:matfren:5:1:0', '5', '1', '0'] });
  const h = createHandlers({ storage, telegram: both.telegram });

  await h.materialFileRenameOffline(both.ctx);
  await h.materialFileRenameOffline(none.ctx);

  assert.equal(prompts.length, 0);
  assert.equal(both.calls.answerCbQuery[0][0], MAT.selectOne);
  assert.equal(none.calls.answerCbQuery[0][0], MAT.selectOne);
});

test('group: renaming one selected file arms a materialFileRename prompt with chat token', async () => {
  const prompts = [];
  const storage = twoFileStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  const { ctx, telegram } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:matfren:123:1:1', '123', '1', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialFileRenameGroup(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.action, 'materialFileRename');
  assert.equal(prompts[0].rec.surface, 'group');
  assert.equal(prompts[0].rec.token, '123');
  assert.equal(prompts[0].rec.materialId, 1);
  // Mask 1 → file index 0 (id 11).
  assert.equal(prompts[0].rec.fileId, 11);
});

// ── Media capture (onMedia) ────────────────────────────────────────────────

test('onMedia: first captioned file creates the lesson, appends the file, re-arms', async () => {
  const added = [];
  const files = [];
  const prompts = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: null, count: 0 }),
    addMaterial: async (g, m) => { added.push({ g, m }); return 2; },
    addMaterialFile: async (id, f) => { files.push({ id, f }); return 3; },
    setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: 'عنوان المادة', document: { file_id: 'FIDX', file_name: 'a.pdf' } });

  let nextCalled = false;
  await h.onMedia(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(added.length, 1);
  assert.equal(added[0].m.title, 'عنوان المادة');
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 2);
  assert.equal(files[0].f.fileId, 'FIDX');
  assert.equal(files[0].f.fileType, 'document');
  // The caption names the file (and doubles as the lesson title on the first).
  assert.equal(files[0].f.fileName, 'عنوان المادة');
  // A fresh prompt is armed carrying the new lesson id and running count.
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.materialId, 2);
  assert.equal(prompts[0].rec.count, 1);
  // The panel is refreshed to the session view.
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('onMedia: a later file appends to the open lesson without a caption', async () => {
  const added = [];
  const files = [];
  const prompts = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: 2, title: 'عنوان المادة', count: 1 }),
    addMaterial: async (g, m) => { added.push({ g, m }); return 99; },
    addMaterialFile: async (id, f) => { files.push({ id, f }); return 4; },
    setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: '', document: { file_id: 'FIDY', file_name: 'b.pdf' } });

  await h.onMedia(ctx, async () => {});

  assert.equal(added.length, 0, 'existing lesson is not re-created');
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 2);
  assert.equal(files[0].f.fileId, 'FIDY');
  // No caption -> fall back to the attachment's own filename.
  assert.equal(files[0].f.fileName, 'b.pdf');
  assert.equal(prompts[0].rec.count, 2);
});

test('onMedia: an uncaptioned album photo falls back to the lesson title when no part is set', async () => {
  const files = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: 2, title: 'عنوان المادة', count: 1 }),
    addMaterialFile: async (id, f) => { files.push(f); return 4; },
    setReplyPrompt: async () => {},
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  // A photo has no filename, and album items after the first carry no caption.
  const { ctx } = mediaCtx({ caption: '', document: null, photo: [{ file_id: 'PIMG' }] });

  await h.onMedia(ctx, async () => {});

  assert.equal(files.length, 1);
  assert.equal(files[0].fileType, 'photo');
  // No caption, no part, no filename -> falls back to the lesson title (not "file N").
  assert.equal(files[0].fileName, 'عنوان المادة');
});

test('onMedia: an uncaptioned file inherits the current part name (last caption)', async () => {
  const files = [];
  const storage = matStorage({
    // A prior captioned file set the part name to "النطق" (pronunciation).
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: 2, title: 'الحروف', lastCaption: 'النطق', count: 1 }),
    addMaterialFile: async (id, f) => { files.push(f); return 4; },
    setReplyPrompt: async () => {},
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: '', document: null, photo: [{ file_id: 'PIMG' }] });

  await h.onMedia(ctx, async () => {});

  assert.equal(files.length, 1);
  // Inherits the part name, not the lesson title.
  assert.equal(files[0].fileName, 'النطق');
});

test('onMedia: a captioned file starts a new part that later files inherit', async () => {
  const files = [];
  const prompts = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: 2, title: 'الحروف', lastCaption: 'النطق', count: 1 }),
    addMaterialFile: async (id, f) => { files.push(f); return 4; },
    setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  // A new captioned photo opens the "الكتابة" (writing) part.
  const { ctx } = mediaCtx({ caption: 'الكتابة', document: null, photo: [{ file_id: 'PIMG' }] });

  await h.onMedia(ctx, async () => {});

  assert.equal(files[0].fileName, 'الكتابة');
  // The session now remembers the new part name for subsequent uncaptioned files.
  assert.equal(prompts[0].rec.lastCaption, 'الكتابة');
});

test('onMedia: a later file caption becomes that file\'s name', async () => {
  const files = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: 2, title: 'الدرس', count: 1 }),
    addMaterialFile: async (id, f) => { files.push(f); return 4; },
    setReplyPrompt: async () => {},
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: 'الوجه الثاني', document: { file_id: 'FIDZ', file_name: 'c.pdf' } });

  await h.onMedia(ctx, async () => {});

  assert.equal(files.length, 1);
  // Caption wins over the attachment filename.
  assert.equal(files[0].fileName, 'الوجه الثاني');
});

test('onMedia: the largest photo size is captured', async () => {
  const files = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'group', groupId: '123', chatId: 123, msgId: 555, materialId: null, count: 0 }),
    addMaterial: async () => 3,
    addMaterialFile: async (id, f) => { files.push(f); return 5; },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({
    document: null,
    photo: [{ file_id: 'small' }, { file_id: 'medium' }, { file_id: 'large' }],
    caption: 'صورة',
  });

  await h.onMedia(ctx, async () => {});

  assert.equal(files.length, 1);
  assert.equal(files[0].fileId, 'large');
  assert.equal(files[0].fileType, 'photo');
});

test('onMedia: a first file with no caption is rejected and the prompt stays open', async () => {
  let deleted = false;
  let added = 0;
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, materialId: null, count: 0 }),
    delReplyPrompt: async () => { deleted = true; },
    addMaterial: async () => { added += 1; return 1; },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls } = mediaCtx({ caption: '', document: { file_id: 'FIDX' } });

  await h.onMedia(ctx, async () => {});

  assert.equal(added, 0);
  assert.equal(deleted, false);
  assert.equal(calls.reply[0][0], MAT.noCaption);
});

test('onMedia: a reply to an unrelated prompt is passed through', async () => {
  const storage = matStorage({ getReplyPrompt: async () => ({ action: 'add' }) });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: 'x', document: { file_id: 'F' } });

  let nextCalled = false;
  await h.onMedia(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('onMedia: media that is not a reply is passed through', async () => {
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage: matStorage(), telegram });
  const { ctx } = mediaCtx({ reply: false, document: { file_id: 'F' }, caption: 'x' });

  let nextCalled = false;
  await h.onMedia(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('onMedia: an album item without a reply appends to the active session', async () => {
  // Simulates the 2nd+ file of an album send: Telegram sets reply_to only on the
  // first item, so the rest arrive with no reply. They must still be captured.
  const files = [];
  const prompts = [];
  const storage = matStorage({
    getReplyPrompt: async () => null,
    getActiveReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555, promptMsgId: 600, materialId: 2, title: 'الدرس', count: 1 }),
    addMaterialFile: async (id, f) => { files.push({ id, f }); return 4; },
    setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ msgId, rec }); },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ reply: false, document: { file_id: 'FID2', file_name: 'second.pdf' } });

  let nextCalled = false;
  await h.onMedia(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);          // captured, not passed through
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 2);             // appended to the open lesson
  assert.equal(files[0].f.fileId, 'FID2');
  assert.equal(prompts[0].msgId, 600);      // same session prompt (no rotation)
  assert.equal(prompts[0].rec.count, 2);    // running count advanced
});

// ── Add files to an existing lesson + finishing a session ───────────────────

test('offline: add-file opens a session preset to the existing lesson', async () => {
  const prompts = [];
  const storage = matStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push(rec); } });
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matfadd:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialFileAddOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'materialUpload');
  assert.equal(prompts[0].materialId, 1);
  assert.equal(prompts[0].count, 1);
  // Panel becomes the session view with a Done button carrying the prompt id.
  const data = editData(calls);
  assert.ok(data.some((cb) => cb.startsWith('o:matdone:5:')));
});

test('offline: item menu offers an add-file button', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matit:5:1', '5', '1'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialItemOffline(ctx);

  assert.ok(editData(calls).includes('o:matfadd:5:1'));
});

test('offline: done closes the session prompt and re-renders the list', async () => {
  const deleted = [];
  const storage = matStorage({ delReplyPrompt: async (chatId, msgId) => { deleted.push([chatId, msgId]); } });
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, chatId: 777, match: ['o:matdone:5:901', '5', '901'] });
  const h = createHandlers({ storage, telegram });

  await h.materialDoneOffline(ctx);

  assert.deepEqual(deleted, [['777', 901]]);
  assert.ok(editData(calls).includes('o:matadd:5'));
});

test('group: done closes the session prompt and re-renders the list', async () => {
  const deleted = [];
  const storage = matStorage({ delReplyPrompt: async (chatId, msgId) => { deleted.push([chatId, msgId]); } });
  const { telegram } = telegramWithSend();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:matdone:123:901', '123', '901'] });
  const h = createHandlers({ storage, telegram });

  await h.materialDoneGroup(ctx);

  assert.deepEqual(deleted, [['123', 901]]);
  assert.ok(editData(calls).includes('mg:matadd:123'));
});

test('offline: sending a lesson with several files resends each in order', async () => {
  const { telegram, sent } = telegramWithSend();
  const storage = matStorage({
    getMaterialById: async () => ({
      id: 1, title: 'درس', addedBy: null, createdAt: null, fileCount: 2,
      files: [
        { id: 11, fileId: 'F1', fileType: 'document', fileName: null, position: 1 },
        { id: 12, fileId: 'F2', fileType: 'photo', fileName: null, position: 2 },
      ],
    }),
  });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:matget:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialGetOffline(ctx);

  assert.equal(sent.sendDocument.length, 1);
  assert.equal(sent.sendDocument[0][1], 'F1');
  assert.equal(sent.sendPhoto.length, 1);
  assert.equal(sent.sendPhoto[0][1], 'F2');
});

// ── Group /manage surface ──────────────────────────────────────────────────

test('group: admin sees the materials list', async () => {
  const { telegram } = telegramWithSend();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:mat:123', '123'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialsGroup(ctx);

  const data = editData(calls);
  assert.ok(data.includes('mg:matadd:123'));
  assert.ok(data.includes('mg:matit:123:1'));
  assert.ok(data.includes('mg:home:123'));
});

test('group: non-admin is rejected', async () => {
  const { telegram } = telegramWithSend({ getChatMember: async () => ({ status: 'member' }) });
  const { ctx, calls } = makeCtx({ chatType: 'group', chatId: 123, match: ['mg:mat:123', '123'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialsGroup(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

test('group: send-to-group resends the file into the group chat', async () => {
  const { telegram, sent } = telegramWithSend();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:matsend:123:1', '123', '1'] });
  const h = createHandlers({ storage: matStorage(), telegram });

  await h.materialSendGroup(ctx);

  assert.equal(sent.sendDocument.length, 1);
  assert.equal(sent.sendDocument[0][0], '123');
  assert.equal(sent.sendDocument[0][1], 'FID1');
  assert.equal(calls.answerCbQuery[0][0], MAT.sentToGroup);
});

// ── Rename ─────────────────────────────────────────────────────────────────

test('offline: rename prompt stores a materialRename reply prompt', async () => {
  const prompts = [];
  const storage = matStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  const { ctx, telegram } = makeCtx({ userId: OWNER, match: ['o:matren:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialRenameOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.action, 'materialRename');
  assert.equal(prompts[0].rec.surface, 'offline');
  assert.equal(prompts[0].rec.token, '5');
  assert.equal(prompts[0].rec.materialId, 1);
});

test('group: rename prompt stores a materialRename reply prompt with chat token', async () => {
  const prompts = [];
  const storage = matStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push({ chatId, msgId, rec }); } });
  const { ctx, telegram } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:matren:123:1', '123', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.materialRenameGroup(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].rec.action, 'materialRename');
  assert.equal(prompts[0].rec.surface, 'group');
  assert.equal(prompts[0].rec.token, '123');
  assert.equal(prompts[0].rec.materialId, 1);
});

// ── Selective send ─────────────────────────────────────────────────────────

// A lesson with three files, for exercising the per-file picker.
function threeFileStorage(overrides = {}) {
  const material = {
    id: 1, title: 'درس', addedBy: null, createdAt: null,
    files: [
      { id: 11, fileId: 'FID1', fileType: 'document', fileName: 'أ.pdf', position: 1 },
      { id: 12, fileId: 'FID2', fileType: 'photo', fileName: null, position: 2 },
      { id: 13, fileId: 'FID3', fileType: 'video', fileName: 'ج.mp4', position: 3 },
    ],
    fileCount: 3,
  };
  return matStorage({
    getMaterialById: async () => material,
    getMaterials: async () => [material],
    ...overrides,
  });
}

test('offline: menu offers the select button only with more than one file', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matit:5:1', '5', '1'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialItemOffline(ctx);

  assert.ok(editData(calls).includes('o:matsel:5:1'));
});

test('offline: opening the picker defaults to all files selected', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matsel:5:1', '5', '1'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialSelectOffline(ctx);

  // mask 0b111 = 7 → each toggle button and the send button carry mask 7.
  const data = editData(calls);
  assert.ok(data.includes('o:matseltog:5:1:0:7'));
  assert.ok(data.includes('o:matseltog:5:1:1:7'));
  assert.ok(data.includes('o:matseltog:5:1:2:7'));
  assert.ok(data.includes('o:matselsend:5:1:7'));
});

test('offline: toggling a file flips its bit in the mask', async () => {
  const { ctx, calls, telegram } = makeCtx({ userId: OWNER, match: ['o:matseltog:5:1:1:7', '5', '1', '1', '7'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialSelectToggleOffline(ctx);

  // Clearing bit 1 (7 ^ 0b010 = 5) → send button now carries mask 5.
  assert.ok(editData(calls).includes('o:matselsend:5:1:5'));
});

test('offline: sending a subset delivers only the checked files to the uploader', async () => {
  const { telegram, sent } = telegramWithSend();
  // mask 5 = 0b101 → files at index 0 (document) and 2 (video).
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:matselsend:5:1:5', '5', '1', '5'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialSelectSendOffline(ctx);

  assert.equal(sent.sendDocument.length, 1);
  assert.equal(sent.sendDocument[0][1], 'FID1');
  assert.equal(sent.sendVideo.length, 1);
  assert.equal(sent.sendVideo[0][1], 'FID3');
  assert.equal(sent.sendPhoto.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.sentSelected(2));
});

test('offline: sending with an empty selection warns and sends nothing', async () => {
  const { telegram, sent } = telegramWithSend();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:matselsend:5:1:0', '5', '1', '0'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialSelectSendOffline(ctx);

  assert.equal(sent.sendDocument.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.selectNone);
});

test('group: sending a subset delivers only the checked files into the group', async () => {
  const { telegram, sent } = telegramWithSend();
  // mask 6 = 0b110 → files at index 1 (photo) and 2 (video).
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: 123, match: ['mg:matselsend:123:1:6', '123', '1', '6'] });
  const h = createHandlers({ storage: threeFileStorage(), telegram });

  await h.materialSelectSendGroup(ctx);

  assert.equal(sent.sendPhoto.length, 1);
  assert.equal(sent.sendPhoto[0][0], '123');
  assert.equal(sent.sendVideo.length, 1);
  assert.equal(sent.sendDocument.length, 0);
  assert.equal(calls.answerCbQuery[0][0], MAT.sentSelected(2));
});

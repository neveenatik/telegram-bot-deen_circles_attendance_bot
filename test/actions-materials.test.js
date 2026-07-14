import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/materials.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const MAT = TEXT.materials;
const OWNER = 1001;

// Storage stub with the materials + class-resolution methods the handlers use.
// Defaults to an owner with one document material; override per test.
function matStorage(overrides = {}) {
  return makeStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'owner', name: 'صف' }),
    getMaterials: async () => [
      { id: 1, title: 'مادة أولى', fileId: 'FID1', fileType: 'document', fileName: null, addedBy: null, createdAt: null },
    ],
    getMaterialById: async (_g, id) => ({
      id: Number(id), title: 'مادة أولى', fileId: 'FID1', fileType: 'document', fileName: null, addedBy: null, createdAt: null,
    }),
    addMaterial: async () => 2,
    removeMaterial: async () => {},
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

// ── Media capture (onMedia) ────────────────────────────────────────────────

test('onMedia: a captioned document reply adds a material and refreshes the panel', async () => {
  const added = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555 }),
    addMaterial: async (g, m) => { added.push({ g, m }); return 2; },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({ caption: 'عنوان المادة', document: { file_id: 'FIDX', file_name: 'a.pdf' } });

  let nextCalled = false;
  await h.onMedia(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(added.length, 1);
  assert.equal(added[0].g, 'offline:o:1');
  assert.equal(added[0].m.title, 'عنوان المادة');
  assert.equal(added[0].m.fileId, 'FIDX');
  assert.equal(added[0].m.fileType, 'document');
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('onMedia: the largest photo size is captured', async () => {
  const added = [];
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'group', groupId: '123', chatId: 123, msgId: 555 }),
    addMaterial: async (g, m) => { added.push(m); return 3; },
  });
  const { telegram } = telegramWithSend();
  const h = createHandlers({ storage, telegram });
  const { ctx } = mediaCtx({
    document: null,
    photo: [{ file_id: 'small' }, { file_id: 'medium' }, { file_id: 'large' }],
    caption: 'صورة',
  });

  await h.onMedia(ctx, async () => {});

  assert.equal(added.length, 1);
  assert.equal(added[0].fileId, 'large');
  assert.equal(added[0].fileType, 'photo');
});

test('onMedia: a file with no caption is rejected and the prompt stays open', async () => {
  let deleted = false;
  let added = 0;
  const storage = matStorage({
    getReplyPrompt: async () => ({ action: 'materialUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 555 }),
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

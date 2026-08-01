import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beginForceReplyAwaiting } from '../lib/helpers.js';
import { makeCtx } from './mocks.js';

// The prompt is shown in the admin's DM (chatId 555) while the real target group
// is a different chat (-100777). Option A keys the reply-prompt record by the
// prompt message's own id in the prompt chat, and carries the real groupId in
// the value so consumers act on the group and not the DM.
function setup() {
  const { ctx, calls } = makeCtx({ chatId: 555, userId: 999, messageId: 42 });
  const setCalls = [];
  const setReplyPrompt = async (chatId, promptMsgId, value) => { setCalls.push([chatId, promptMsgId, value]); };
  return { ctx, calls, setReplyPrompt, setCalls };
}

test('beginForceReplyAwaiting: sends first, then stores keyed by prompt id', async () => {
  const { ctx, calls, setReplyPrompt, setCalls } = setup();
  let sent = 0;

  const result = await beginForceReplyAwaiting(ctx, {
    setReplyPrompt,
    groupId: '-100777',
    record: { action: 'testflow', oldName: 'سارة' },
    sendPrompt: () => { sent += 1; return Promise.resolve({ message_id: 4242 }); },
  });

  // Callback spinner was cleared and the prompt sent exactly once.
  assert.equal(calls.answerCbQuery.length, 1);
  assert.equal(sent, 1);
  assert.deepEqual(result, { message_id: 4242 });

  // Exactly one write, keyed by (prompt chat, prompt message id).
  assert.equal(setCalls.length, 1);
  const [chatId, promptMsgId, value] = setCalls[0];
  assert.equal(chatId, '555');
  assert.equal(promptMsgId, 4242);
  assert.equal(value.groupId, '-100777');
  assert.equal(value.chatId, 555);
  assert.equal(value.msgId, 42);
  assert.equal(value.userId, '999');
  assert.equal(value.action, 'testflow');
  assert.equal(value.oldName, 'سارة');
});

test('beginForceReplyAwaiting: concurrent prompts get distinct keys', async () => {
  const { ctx, setReplyPrompt, setCalls } = setup();
  let nextId = 100;

  await beginForceReplyAwaiting(ctx, {
    setReplyPrompt, groupId: '-100777',
    record: { action: 'rename' },
    sendPrompt: () => Promise.resolve({ message_id: (nextId += 1) }),
  });
  await beginForceReplyAwaiting(ctx, {
    setReplyPrompt, groupId: '-100777',
    record: { action: 'editPage' },
    sendPrompt: () => Promise.resolve({ message_id: (nextId += 1) }),
  });

  // Two open prompts coexist under different prompt-message-id keys — no block.
  assert.equal(setCalls.length, 2);
  assert.equal(setCalls[0][1], 101);
  assert.equal(setCalls[1][1], 102);
  assert.notEqual(setCalls[0][1], setCalls[1][1]);
});

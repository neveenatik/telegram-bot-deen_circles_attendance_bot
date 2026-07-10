import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/confirm.js';
import { TEXT } from '../lib/text.js';
import { setPendingConfirm } from '../lib/confirmations.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('confirm: non-creator is rejected', async () => {
  const { confirm } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ admin: true, match: ['cf:ok:ABC123', 'ok', 'ABC123'] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.creatorOnly]]);
});

test('confirm: unknown token answers confirmNotFound', async () => {
  const { confirm } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ creator: true, match: ['cf:ok:ZZZ999', 'ok', 'ZZZ999'] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.confirmNotFound]]);
});

test('confirm: cancel mode edits the message and clears the token', async () => {
  const token = setPendingConfirm(999, { action: 'noop' });
  const { confirm } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ creator: true, userId: 999, match: [`cf:cancel:${token}`, 'cancel', token] });

  await confirm(ctx);

  assert.equal(calls.editMessageText[0][0], TEXT.confirmCancelled);
});

test('confirm: token owned by a different user is rejected', async () => {
  const token = setPendingConfirm(111, { action: 'noop' });
  const { confirm } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ creator: true, userId: 222, match: [`cf:ok:${token}`, 'ok', token] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.confirmNotOwner]]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT } from '../lib/text.js';
import { buildSessionListTexts } from '../lib/widgets.js';
import * as participants from '../lib/sessionParticipants.js';
import { createHandlers as createAttendanceHandlers } from '../lib/handlers/actions/attendance.js';
import { createHandlers as createMembersHandlers } from '../lib/handlers/actions/members.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

// A walk-in who taps a roster/recitation list is counted present immediately but
// still awaits admin approval. She carries a `pendingApproval` flag on her
// participant record; the LIVE list widget tags her ⏳ so the teacher can tell
// her apart from confirmed roster members. The flag is cleared on approve or
// dismiss, at which point the tag disappears.

const PENDING_TAG = TEXT.pendingApprovalTag; // '⏳ قيد الموافقة'

function guestRec(name, extra = {}) {
  return { name, memberId: null, status: 'present', called: null, ...extra };
}

test('live list: tags a pending walk-in with the ⏳ approval marker', () => {
  const session = {
    type: 'main',
    name: 'الحلقة',
    active: true,
    participants: {
      'فاطمة محمد': { name: 'فاطمة محمد', memberId: '1005', status: 'present', called: null, listNumber: 5 },
      'زائرة كريمة': guestRec('زائرة كريمة', { pendingApproval: true }),
    },
  };

  const texts = buildSessionListTexts(session, { members: [] }).join('\n');

  assert.ok(texts.includes(`زائرة كريمة ${PENDING_TAG}`), 'pending walk-in is tagged');
  assert.ok(!texts.includes(`فاطمة محمد ${PENDING_TAG}`), 'confirmed member is not tagged');
});

test('live list: an approved (non-pending) walk-in carries no ⏳ tag', () => {
  const session = {
    type: 'main',
    name: 'الحلقة',
    active: true,
    participants: {
      'زائرة كريمة': guestRec('زائرة كريمة', { pendingApproval: false }),
    },
  };

  const texts = buildSessionListTexts(session, { members: [] }).join('\n');

  assert.ok(texts.includes('زائرة كريمة'), 'walk-in name is present');
  assert.ok(!texts.includes(PENDING_TAG), 'no pending tag once approved/dismissed');
});

test('setPendingApproval: toggles the participant flag and surfaces in the view', () => {
  const session = { type: 'main', participants: {} };
  participants.register(session, 'زائرة كريمة', { status: 'present', memberId: '42' });

  participants.setPendingApproval(session, 'زائرة كريمة', true);
  assert.equal(participants.get(session, 'زائرة كريمة').pendingApproval, true);

  participants.setPendingApproval(session, 'زائرة كريمة', false);
  assert.equal(participants.get(session, 'زائرة كريمة').pendingApproval, false);
});

test('mark: a walk-in tap flags the participant as pending in the live session', async () => {
  let pendingStore = [];
  const session = { type: 'main', active: true, registrationActive: true, allowPublicRegistration: false, participants: {} };
  const telegram = makeTelegram();
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [] }),
    getPendingRegistrations: async () => pendingStore,
    savePendingRegistrations: async (_g, pending) => { pendingStore = pending; },
  });
  const { mark } = createAttendanceHandlers({ storage, telegram, refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' }, match: ['a:present', 'present'] });

  await mark(ctx);

  assert.equal(participants.get(session, 'ليان').pendingApproval, true);
});

test('add: approving a pending walk-in clears her ⏳ tag in the live session', async () => {
  const session = {
    type: 'main',
    active: true,
    participants: {
      'ليان': { name: 'ليان', memberId: '42', status: 'present', called: null, pendingApproval: true },
    },
  };
  let pendingStore = [{ userId: '42', name: 'ليان', submittedAt: new Date().toISOString() }];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getMaster: async () => ({ members: [] }),
    getSession: async (_g, type) => (type === 'main' ? session : null),
    getPendingRegistrations: async () => pendingStore,
    savePendingRegistrations: async (_g, pending) => { pendingStore = pending; },
  });
  const { add } = createMembersHandlers({ storage, telegram, refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ admin: true, match: ['pr:123:add:42:0', '123', '42', '0'] });

  await add(ctx);

  assert.equal(participants.get(session, 'ليان').pendingApproval, false);
});


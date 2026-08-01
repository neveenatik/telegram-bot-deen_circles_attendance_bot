import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncSessionNamesFromMaster } from '../lib/sessionSync.js';

const master = () => ({
  members: [
    { userId: '1', name: 'ليان' },
    { userId: '2', name: 'سارة' },
    { userId: '3', name: 'مريم' },
  ],
});

test('sync: recitation-correction list is never seeded from master', () => {
  const session = {
    type: 'registeredSecondary',
    allowPublicRegistration: false,
    participants: {},
  };

  const result = syncSessionNamesFromMaster(session, master());

  assert.deepEqual(result, { changed: false, kept: 0, added: 0, removed: 0 });
  assert.deepEqual(session.participants, {});
});

test('sync: recitation-correction list keeps only self-registered names', () => {
  const session = {
    type: 'registeredSecondary',
    allowPublicRegistration: false,
    participants: {
      'سارة': { name: 'سارة', memberId: '2', status: 'present', called: null, registeredAt: 1000, backup: false },
    },
  };

  const result = syncSessionNamesFromMaster(session, master());

  assert.equal(result.changed, false);
  assert.deepEqual(Object.keys(session.participants), ['سارة']);
});

test('sync: main list is still seeded with the full master roster', () => {
  const session = {
    type: 'main',
    allowPublicRegistration: false,
    participants: {},
  };

  const result = syncSessionNamesFromMaster(session, master());

  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(session.participants).sort(), ['سارة', 'ليان', 'مريم'].sort());
});

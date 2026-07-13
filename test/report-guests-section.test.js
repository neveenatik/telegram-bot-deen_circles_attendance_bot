import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT } from '../lib/text.js';

// Walk-in guests (memberId null) must never mix into the official roster results.
// They are moved to a trailing "زائرات (غير مسجّلات)" section, and a guest still in
// the live pending queue is tagged "⏳ قيد الموافقة".

const GUESTS_TITLE = 'زائرات (غير مسجّلات)';
const PENDING_TAG = '⏳ قيد الموافقة';

function memberRec(name, listNumber, extra = {}) {
  return { name, memberId: String(1000 + listNumber), status: 'present', called: null, listNumber, ...extra };
}
function guestRec(name, extra = {}) {
  return { name, memberId: null, status: 'present', called: null, ...extra };
}

test('report: guests are split into their own section, out of the roster sections', () => {
  const session = {
    type: 'main',
    name: 'الحلقة',
    active: true,
    participants: {
      'فاطمة محمد': memberRec('فاطمة محمد', 5),
      'ضيفة كريمة': guestRec('ضيفة كريمة'),
    },
  };
  const groups = { present: ['فاطمة محمد', 'ضيفة كريمة'], listening: [], excused: [], absent: [] };

  const r = TEXT.report(session, groups);

  assert.ok(r.includes(GUESTS_TITLE), 'guests section title present');
  // The guest appears after the guests title, not inside the "حاضرة" roster block.
  const presentBlock = r.slice(r.indexOf('حاضرة'), r.indexOf(GUESTS_TITLE));
  assert.ok(!presentBlock.includes('ضيفة كريمة'), 'guest not in the roster present block');
  assert.ok(r.includes('ضيفة كريمة'), 'guest still rendered in the guests section');
  assert.ok(!r.includes(PENDING_TAG), 'no pending tag without a pending matcher');
});

test('report: a still-pending guest is tagged, an approved/dismissed guest is not', () => {
  const session = {
    type: 'main',
    name: 'الحلقة',
    active: true,
    participants: {
      'زائرة منتظرة': guestRec('زائرة منتظرة'),
      'زائرة قديمة': guestRec('زائرة قديمة'),
    },
  };
  const groups = { present: ['زائرة منتظرة', 'زائرة قديمة'], listening: [], excused: [], absent: [] };
  const opts = { isPending: (name) => name === 'زائرة منتظرة' };

  const r = TEXT.report(session, groups, opts);

  assert.ok(r.includes(`زائرة منتظرة ${PENDING_TAG}`), 'pending guest tagged');
  assert.ok(!r.includes(`زائرة قديمة ${PENDING_TAG}`), 'non-pending guest untagged');
});

test('groupRecitationReport: guests are separated and pending guests tagged', () => {
  const session = {
    type: 'groupRecitation',
    name: 'تلاوة',
    active: true,
    participants: {
      'هدى محمد': memberRec('هدى محمد', 195, { page: 3 }),
      'زائرة منتظرة': guestRec('زائرة منتظرة', { page: 4 }),
    },
  };
  const opts = { isPending: (name) => name === 'زائرة منتظرة' };

  const r = TEXT.groupRecitationReport(session, opts);

  assert.ok(r.includes(GUESTS_TITLE), 'guests section present');
  assert.ok(r.includes(`زائرة منتظرة ${PENDING_TAG}`), 'pending guest tagged with page');
  const readingBlock = r.slice(r.indexOf('قراءة'), r.indexOf(GUESTS_TITLE));
  assert.ok(!readingBlock.includes('زائرة منتظرة'), 'guest not in the reading roster block');
});

test('secondaryReport: guests go to their own section with verse and pending tag', () => {
  const session = {
    type: 'registeredSecondary',
    name: 'تصحيح',
    active: true,
    participants: {
      'مريم صفا': memberRec('مريم صفا', 157, { verse: 'البقرة 5' }),
      'زائرة منتظرة': guestRec('زائرة منتظرة', { verse: 'آل عمران 7' }),
    },
  };
  const opts = { isPending: () => true };

  const r = TEXT.secondaryReport(session, opts);

  assert.ok(r.includes('157 - مريم صفا — البقرة 5'), 'member with verse in roster');
  assert.ok(r.includes(GUESTS_TITLE), 'guests section present');
  assert.ok(r.includes(`زائرة منتظرة — آل عمران 7 ${PENDING_TAG}`), 'guest verse + pending tag');
});

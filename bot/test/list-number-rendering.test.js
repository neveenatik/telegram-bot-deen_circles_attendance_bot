import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT } from '../lib/text.js';
import { manageText } from '../lib/widgets.js';

// A member carries a roster list_number; a guest (memberId null) has none. The
// rendered label should be "<n> - <name>" for members and just "<name>" for guests.

function memberRec(name, listNumber, extra = {}) {
  return { name, memberId: String(1000 + listNumber), status: 'present', called: null, listNumber, ...extra };
}
function guestRec(name, extra = {}) {
  return { name, memberId: null, status: 'present', called: null, ...extra };
}

test('manageText: prefixes members with their list_number and leaves guests unnumbered', () => {
  const session = {
    type: 'main',
    name: 'الحلقة',
    active: true,
    participants: {
      'فاطمة محمد': memberRec('فاطمة محمد', 5),
      'ضيفة كريمة': guestRec('ضيفة كريمة'),
    },
  };

  const t = manageText(session, { members: [] });

  assert.ok(t.includes('5 - فاطمة محمد'), 'member shows "5 - name"');
  assert.ok(t.includes('ضيفة كريمة'), 'guest name present');
  assert.ok(!t.includes('- ضيفة كريمة'), 'guest is not prefixed with a number');
});

test('report: numbers members within each attendance section, ordered alphabetically', () => {
  const session = {
    type: 'registeredMain',
    name: 'الحلقة',
    active: true,
    participants: {
      'بسمة كمال': memberRec('بسمة كمال', 36),
      'اسراء كمال': memberRec('اسراء كمال', 1),
    },
  };
  const groups = { present: ['بسمة كمال', 'اسراء كمال'], listening: [], excused: [], absent: [] };

  const r = TEXT.report(session, groups);

  assert.ok(r.includes('1 - اسراء كمال'), 'first member numbered');
  assert.ok(r.includes('36 - بسمة كمال'), 'second member numbered');
  // Alphabetical order preserved (اسراء before بسمة) despite the numeric prefix.
  assert.ok(r.indexOf('1 - اسراء كمال') < r.indexOf('36 - بسمة كمال'), 'alphabetical order kept');
});

test('groupRecitationReport: numbers members alongside their page', () => {
  const session = {
    type: 'groupRecitation',
    name: 'تلاوة',
    active: true,
    participants: {
      'هدى محمد': memberRec('هدى محمد', 195, { page: 3 }),
      'زائرة': guestRec('زائرة', { page: 4 }),
    },
  };

  const r = TEXT.groupRecitationReport(session);

  assert.ok(r.includes('195 - هدى محمد'), 'member numbered next to page');
  assert.ok(r.includes('— زائرة'), 'guest rendered without a number');
});

test('secondaryReport: numbers present members with their verse', () => {
  const session = {
    type: 'registeredSecondary',
    name: 'تصحيح',
    active: true,
    participants: {
      'مريم صفا': memberRec('مريم صفا', 157, { verse: 'البقرة 5' }),
    },
  };

  const r = TEXT.secondaryReport(session);

  assert.ok(r.includes('157 - مريم صفا — البقرة 5'), 'member numbered with verse');
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekRosterHtml,
  dayRosterHtml,
  teacherRosterHtml,
  ROSTER_WIDTH,
  LIST_WIDTH,
} from '../lib/render/templates/weekRoster.js';
import { renderHtmlToPng } from '../lib/render/engine.js';
import { localChromePath, closeBrowser } from '../lib/render/browser.js';

const sample = {
  title: 'حلقة الفجر',
  subtitle: '👁️ توقيت العرض: مكة',
  days: [
    {
      day: 'الأحد',
      slots: [
        { time: '17:30', label: '🎓 تدريب', teacher: 'أمل' },
        { time: 'طوال اليوم', label: '📓 مراجعة التكاليف' },
      ],
    },
    {
      day: 'الثلاثاء',
      slots: [{ time: '19:00', label: '📘 حلقة أساسية', teacher: 'هدى' }],
    },
  ],
  footer: 'دائرة دين',
};

test('weekRosterHtml includes title, subtitle, days, slots and teachers (emoji stripped)', () => {
  const html = weekRosterHtml(sample);
  for (const needle of ['حلقة الفجر', 'مكة', 'الأحد', 'الثلاثاء', '17:30', '19:00', 'تدريب', 'حلقة أساسية', 'أمل', 'هدى', 'دائرة دين']) {
    assert.ok(html.includes(needle), `expected roster to include "${needle}"`);
  }
});

test('weekRosterHtml strips emoji from rendered text', () => {
  const html = weekRosterHtml(sample);
  for (const emoji of ['🎓', '📘', '📓', '👁️']) {
    assert.ok(!html.includes(emoji), `did not expect emoji "${emoji}" in rendered text`);
  }
});

test('weekRosterHtml is a fixed-width RTL document with embedded fonts', () => {
  const html = weekRosterHtml(sample);
  assert.ok(html.includes('<html dir="rtl"'), 'expected an RTL <html> root');
  assert.ok(html.includes(`width: ${ROSTER_WIDTH}px`), 'expected the fixed roster width');
  assert.ok(html.includes('@font-face'), 'expected embedded @font-face fonts');
  assert.ok(html.includes("font-family: 'Cairo'"), 'expected the Cairo font family');
});

test('weekRosterHtml escapes HTML in caller-supplied text', () => {
  const html = weekRosterHtml({ title: 'a<b> & "c"', days: [] });
  assert.ok(html.includes('a&lt;b&gt; &amp; &quot;c&quot;'));
  assert.ok(!html.includes('a<b>'), 'raw markup must not leak into the document');
});

test('weekRosterHtml handles an empty week without throwing', () => {
  const html = weekRosterHtml({ title: 'فارغ', days: [] });
  assert.ok(html.includes('فارغ'));
});

const daySample = {
  title: 'حلقات الأربعاء',
  subtitle: '👁️ توقيت العرض: القاهرة',
  slots: [
    { time: '10:00', kind: 'training', label: 'حلقة تدريب', teacher: 'إسراء' },
    { time: '19:00', kind: 'main', label: 'الحلقة الأساسية', teacher: 'نهى' },
    { time: 'طوال اليوم', kind: 'homeworkReview', label: '📓 مراجعة التكاليف', teacher: 'هيام' },
  ],
  footer: 'دائرة دين',
};

test('dayRosterHtml lists a day\'s sessions with short kind labels and teachers', () => {
  const html = dayRosterHtml(daySample);
  for (const needle of ['حلقات الأربعاء', '10:00', '19:00', 'تدريب', 'أساسي', 'إسراء', 'نهى', 'هيام', 'مراجعة التكاليف']) {
    assert.ok(html.includes(needle), `expected day roster to include "${needle}"`);
  }
});

test('dayRosterHtml is a fixed-width RTL document with embedded fonts', () => {
  const html = dayRosterHtml(daySample);
  assert.ok(html.includes('<html dir="rtl"'), 'expected an RTL <html> root');
  assert.ok(html.includes(`width: ${LIST_WIDTH}px`), 'expected the list roster width');
  assert.ok(html.includes('@font-face'), 'expected embedded @font-face fonts');
});

test('dayRosterHtml strips emoji from rendered text', () => {
  const html = dayRosterHtml(daySample);
  assert.ok(!html.includes('📓'), 'did not expect emoji in rendered text');
});

test('dayRosterHtml shows a placeholder when the day is empty', () => {
  const html = dayRosterHtml({ title: 'يوم فارغ', slots: [] });
  assert.ok(html.includes('لا توجد حلقات'));
});

const teacherSample = {
  title: 'جدول أ.منال',
  subtitle: '👁️ توقيت العرض: القاهرة',
  days: [
    { day: 'السبت', slots: [{ time: '20:00', kind: 'registeredSecondary', label: 'تصحيح', teacher: 'أ.منال' }] },
    { day: 'الجمعة', slots: [{ time: '10:00', kind: 'training', label: 'تدريب', teacher: 'أ.منال' }] },
  ],
  footer: 'دائرة دين',
};

test('teacherRosterHtml groups sessions by day with kind labels', () => {
  const html = teacherRosterHtml(teacherSample);
  for (const needle of ['جدول أ.منال', 'السبت', 'الجمعة', '20:00', '10:00', 'تصحيح التلاوة', 'تدريب']) {
    assert.ok(html.includes(needle), `expected teacher roster to include "${needle}"`);
  }
});

test('teacherRosterHtml omits the (fixed) teacher name from rows', () => {
  const html = teacherRosterHtml(teacherSample);
  assert.ok(!html.includes('class="row-teacher"'), 'teacher rows should not render a teacher line');
});

test('teacherRosterHtml is a fixed-width RTL document', () => {
  const html = teacherRosterHtml(teacherSample);
  assert.ok(html.includes('<html dir="rtl"'), 'expected an RTL <html> root');
  assert.ok(html.includes(`width: ${LIST_WIDTH}px`), 'expected the list roster width');
});

test('teacherRosterHtml shows a placeholder when there are no days', () => {
  const html = teacherRosterHtml({ title: 'فارغ', days: [] });
  assert.ok(html.includes('لا توجد حلقات'));
});

// Actual browser rendering needs a Chrome binary; skip where none is installed
// (e.g. CI) so the suite stays green without a browser.
const hasChrome = Boolean(localChromePath());

test('renderHtmlToPng produces a valid PNG buffer from the roster', { skip: !hasChrome }, async () => {
  const png = await renderHtmlToPng(weekRosterHtml(sample), { width: ROSTER_WIDTH, scale: 1 });
  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 1000, 'expected a non-trivial PNG');
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('renderHtmlToPng produces valid PNGs from the day and teacher rosters', { skip: !hasChrome }, async () => {
  for (const html of [dayRosterHtml(daySample), teacherRosterHtml(teacherSample)]) {
    const png = await renderHtmlToPng(html, { width: LIST_WIDTH, scale: 1 });
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
});

after(async () => {
  await closeBrowser();
});

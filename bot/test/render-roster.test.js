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

// ── Dense, real-world fixtures ────────────────────────────────────────────
// Mirror an actual busy week so the render exercises stacked all-day reviews,
// multiple same-time trainings and mixed session types end to end.
const REVIEW = 'مراجعة التكاليف';
const CORRECT = 'تصحيح التلاوة';
const BASIC = 'الحلقة الأساسية';
const TRAIN = 'حلقة تدريب';
const ALLDAY = 'طوال اليوم';
const review = (t) => ({ time: ALLDAY, kind: 'homeworkReview', label: REVIEW, teacher: t });
const mainSlot = (time, t) => ({ time, kind: 'main', label: BASIC, teacher: t });
const correct = (time, t) => ({ time, kind: 'registeredSecondary', label: CORRECT, teacher: t });
const train = (time, t) => ({ time, kind: 'training', label: TRAIN, teacher: t });

const denseDay = {
  title: 'حلقات الأربعاء',
  subtitle: '👁️ توقيت العرض: القاهرة (+2)',
  slots: [
    review('ملكة أحمد'), review('لمياء سعد'), review('اسراء عبد الناصر'), review('حسناء الغريب'),
    review('أروى محمد'), review('هيام فرج'), review('منى محمود'),
    train('10:00', 'أ.إسراء سمير'),
    train('14:00', 'أ.ريهام محمد عبد الله'),
    train('17:00', 'أ.بدرية مصطفى أحمد'),
    train('18:00', 'أ.ياسمين عشري'),
    train('18:00', 'أ.أسماء معوض حمودة'),
    mainSlot('19:00', 'أ.نهى عيد'),
  ],
  footer: 'دائرة دين — نسأل الله التوفيق والسداد',
};

const denseTeacher = {
  title: 'جدول أ.منال رجب',
  subtitle: '👁️ توقيت العرض: القاهرة (+2)',
  days: [
    { day: 'السبت', slots: [correct('20:00', 'أ.منال رجب')] },
    { day: 'الثلاثاء', slots: [review('أ.منال رجب'), train('12:00', 'أ.منال رجب')] },
    { day: 'الجمعة', slots: [train('10:00', 'أ.منال رجب'), correct('15:00', 'أ.منال رجب')] },
  ],
  footer: 'دائرة دين — نسأل الله التوفيق والسداد',
};

test('dayRosterHtml renders every slot of a dense day', () => {
  const html = dayRosterHtml(denseDay);
  for (const needle of [
    'ملكة أحمد', 'لمياء سعد', 'اسراء عبد الناصر', 'حسناء الغريب', 'أروى محمد', 'هيام فرج', 'منى محمود',
    '10:00', '14:00', '17:00', '18:00', '19:00',
    'أ.إسراء سمير', 'أ.ريهام محمد عبد الله', 'أ.بدرية مصطفى أحمد', 'أ.ياسمين عشري', 'أ.أسماء معوض حمودة', 'أ.نهى عيد',
  ]) {
    assert.ok(html.includes(needle), `expected dense day roster to include "${needle}"`);
  }
});

test('teacherRosterHtml renders every day of a dense teacher schedule', () => {
  const html = teacherRosterHtml(denseTeacher);
  // Slots with a `kind` render the kind's short pill label, not the raw label.
  for (const needle of ['السبت', 'الثلاثاء', 'الجمعة', '20:00', '12:00', '10:00', '15:00', 'تصحيح التلاوة', 'مراجعة التكاليف', 'تدريب']) {
    assert.ok(html.includes(needle), `expected dense teacher roster to include "${needle}"`);
  }
});

test('renderHtmlToPng produces valid PNGs from the dense day and teacher rosters', { skip: !hasChrome }, async () => {
  for (const [html, width] of [[dayRosterHtml(denseDay), LIST_WIDTH], [teacherRosterHtml(denseTeacher), LIST_WIDTH]]) {
    const png = await renderHtmlToPng(html, { width, scale: 1 });
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.length > 1000, 'expected a non-trivial PNG');
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
});

after(async () => {
  await closeBrowser();
});

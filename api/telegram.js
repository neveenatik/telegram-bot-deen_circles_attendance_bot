// Vercel serverless webhook endpoint for Telegram.
// Telegram POSTs updates here; we hand each one to the bot.
import bot from '../index.js';
import storage from '../lib/storage.js';

export const maxDuration = 60;

const HTML_DOCS = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بوت حضور حلقات العلم | Deen Circles Attendance Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    header h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    header p { font-size: 1.1rem; opacity: 0.9; }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    section {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    h2 {
      color: #667eea;
      margin-bottom: 1.5rem;
      border-bottom: 3px solid #667eea;
      padding-bottom: 0.5rem;
    }
    h3 {
      color: #764ba2;
      margin-top: 1.5rem;
      margin-bottom: 0.8rem;
    }
    .command {
      background: #f9f9f9;
      border-left: 4px solid #667eea;
      padding: 1rem;
      margin-bottom: 1.5rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
    .command .cmd {
      color: #667eea;
      font-weight: bold;
      font-size: 1.05rem;
    }
    .command .desc {
      color: #666;
      font-family: 'Segoe UI', sans-serif;
      margin-top: 0.5rem;
      font-size: 0.95rem;
    }
    .example {
      background: #f0f4ff;
      border-left: 4px solid #764ba2;
      padding: 1rem;
      margin: 1rem 0;
      border-radius: 4px;
      font-size: 0.95rem;
    }
    .example strong { color: #764ba2; }
    .badge {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.3rem 0.8rem;
      border-radius: 20px;
      font-size: 0.8rem;
      margin-right: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .badge.admin { background: #f59e0b; }
    .badge.creator { background: #ef4444; }
    .workflow {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 1.5rem;
      margin: 1.5rem 0;
      border-radius: 4px;
    }
    .workflow h4 {
      color: #d97706;
      margin-bottom: 0.8rem;
    }
    .workflow ol { margin-left: 2rem; }
    .workflow li { margin-bottom: 0.5rem; }
    .session-type {
      background: #ecfdf5;
      border-left: 4px solid #10b981;
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 4px;
    }
    .session-type h4 { color: #059669; margin-bottom: 0.5rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin: 1.5rem 0;
    }
    .card {
      background: #f9f9f9;
      padding: 1.5rem;
      border-radius: 8px;
      border-top: 4px solid #667eea;
    }
    .card h4 { color: #667eea; margin-bottom: 0.5rem; }
    footer {
      text-align: center;
      padding: 2rem;
      color: #999;
      font-size: 0.9rem;
    }
    a {
      color: #667eea;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    @media (max-width: 600px) {
      header h1 { font-size: 1.8rem; }
      section { padding: 1.5rem; }
      .container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>📚 بوت حضور حلقات العلم</h1>
    <p>Deen Circles Attendance Bot</p>
    <p style="font-size: 0.9rem; margin-top: 0.5rem;">نظام إدارة الحضور والتسجيل لحلقات العلم</p>
  </header>

  <div class="container">
    <!-- Getting Started -->
    <section>
      <h2>🚀 البدء السريع</h2>
      <p>بوت حضور حلقات العلم يساعد في إدارة الحضور والتسجيل لحلقات علوم الدين.</p>
      
      <div class="workflow">
        <h4>خطوات الإعداد الأولى (للمشرف):</h4>
        <ol>
          <li>أضف البوت إلى مجموعتك على تيليغرام</li>
          <li>استخدم <code>/students</code> كطريقة موصى بها لإدارة قائمة الطالبات</li>
          <li>استخدم <code>/addstudent [رقم الحساب] | [الاسم]</code> لإضافة طالبات</li>
          <li>استخدم <code>/startlist [اسم]</code> لبدء جلسة حضور</li>
          <li>اضغط الأزرار لتسجيل حالات الحضور</li>
          <li>استخدم <code>/stoplist</code> لإنهاء الجلسة</li>
        </ol>
      </div>
    </section>

    <!-- Session Types -->
    <section>
      <h2>📊 أنواع الجلسات</h2>
      <p>البوت يدعم 5 أنواع مختلفة من الجلسات، كل منها يخدم غرضاً مختلفاً:</p>
      
      <div class="session-type">
        <h4>📖 قائمة الحلقة الرئيسية <span class="badge">للمسجلات فقط</span></h4>
        <p><strong>الأمر:</strong> <code>/startlist [اسم]</code></p>
        <p>للطالبات المسجلات فقط. تتبع الحضور والاستماع والاعتذار.</p>
      </div>

      <div class="session-type">
        <h4>🌐 قائمة مفتوحة <span class="badge">للجميع</span></h4>
        <p><strong>الأمر:</strong> <code>/startopenlist [اسم]</code></p>
        <p>أي طالبة يمكنها الانضمام. مناسبة للفعاليات العامة.</p>
      </div>

      <div class="session-type">
        <h4>🎯 قائمة ثانوية (تصحيح التلاوة) <span class="badge">للمسجلات فقط</span></h4>
        <p><strong>الأمر:</strong> <code>/startsecondarylist [اسم]</code></p>
        <p>لحلقات تصحيح التلاوة. تُسجِّل الطالبة نفسها عبر زرّي إقرار: «✅ حضرتُ الحلقة الأساسية وأُسجّل» أو «📝 لم أحضر الحلقة الأساسية وأُسجّل»، ومن لم تحضر الأساسية تُوسم في القائمة.</p>
        <p>عند تجميد القائمة (<code>/freezelist</code>) يُغلق التسجيل الأساسي لكن يبقى <strong>التسجيل الاحتياطي</strong> متاحاً (عند توفّر مكان)، وتظهر المسجّلات احتياطياً في قسم مستقل أسفل القائمة. يمكن للمشرفة تعديل حقلَي «حضور الأساسية» و«الاحتياط» لكل طالبة لاحقاً من <code>/classhistory</code>.</p>
      </div>

      <div class="session-type">
        <h4>🎙️ ختمة فردية <span class="badge">تتبع صفحات</span></h4>
        <p><strong>الأمر:</strong> <code>/startpersonalrecitation [اسم]</code></p>
        <p>كل طالبة ترتقي من آخر صفحة وصلت إليها.</p>
      </div>

      <div class="session-type">
        <h4>📚 ختمة جماعية <span class="badge">متسلسلة</span></h4>
        <p><strong>الأمر:</strong> <code>/startgrouprecitation [اسم]</code></p>
        <p>صفحة واحدة لكل حاضرة، متسلسلة للختمة الجماعية.</p>
      </div>
    </section>

    <!-- Core Commands -->
    <section>
      <h2>⚙️ الأوامر الأساسية</h2>
      
      <h3>👥 إدارة الطالبات</h3>
      <div class="command">
        <div class="cmd">/register</div>
        <div class="desc">إرسال رسالة تحتوي زر "طلب التسجيل" لتقديم الطلبات مباشرة داخل المجموعة</div>
      </div>

      <div class="command">
        <div class="cmd">/pendingstudents</div>
        <div class="desc">مراجعة طلبات التسجيل المعلّقة — من زر «طلب التسجيل» أو من ضيفة سجّلت نفسها في قائمة حضور — ثم قبول الطالبة أو تجاهل الطلب</div>
      </div>

      <div class="command">
        <div class="cmd">/students</div>
        <div class="desc">الطريقة الموصى بها لإدارة قائمة الطالبات مع خيارات إضافة/حذف/تعديل</div>
      </div>

      <div class="command">
        <div class="cmd">/addstudent [معرّف] | [اسم]</div>
        <div class="desc">إضافة طالبة أو أكثر — يمكن فصل الإدخالات بسطر جديد أو فاصلة</div>
      </div>

      <div class="command">
        <div class="cmd">/removestudent [اسم أو معرّف]</div>
        <div class="desc">حذف احتياطي لطالبة أو أكثر — يمكن فصل الإدخالات بسطر جديد أو فاصلة</div>
      </div>

      <div class="command">
        <div class="cmd">/removestudents</div>
        <div class="desc">حذف جميع الطالبات المسجلات — متاح لمنشئ المجموعة فقط وبعد تأكيد</div>
      </div>

      <div class="command">
        <div class="cmd">/renamestudent [قديم] | [جديد]</div>
        <div class="desc">تعديل اسم طالبة أو أكثر — سطر جديد لكل إدخال</div>
      </div>

      <div class="command">
        <div class="cmd">/myid</div>
        <div class="desc">إظهار معرّف الطالبة للتسجيل اليدوي (كخيار احتياطي أثناء تثبيت نظام /register)</div>
      </div>

      <h3>🎤 إدارة المعلمات</h3>
      <div class="command">
        <div class="cmd">/addteacher [معرّف] | [اسم] | [نوع]</div>
        <div class="desc">إضافة معلمة أو أكثر (سطر لكل إدخال) — الأنواع: courseteacher, trainingteacher, recitationteacher, homeworkteacher</div>
      </div>

      <div class="command">
        <div class="cmd">/assignteacher [الاسم] | [النوع]</div>
        <div class="desc">تغيير نوع معلمة أو أكثر — سطر لكل إدخال</div>
      </div>

      <div class="command">
        <div class="cmd">/removeteacher [الاسم]</div>
        <div class="desc">حذف معلمة أو أكثر — يمكن فصل الأسماء بسطر جديد أو فاصلة</div>
      </div>

      <div class="command">
        <div class="cmd">/listteachers</div>
        <div class="desc">عرض جميع المعلمات مجمعة حسب النوع</div>
      </div>

      <div class="command">
        <div class="cmd">/tagstudents</div>
        <div class="desc">الإشارة إلى جميع الطالبات المسجلات في الإعلانات</div>
      </div>

      <div class="command">
        <div class="cmd">/tagteachers [نوع]</div>
        <div class="desc">الإشارة إلى المعلمات حسب النوع (courseteacher | trainingteacher | recitationteacher | homeworkteacher)</div>
      </div>

      <h3>� التواصل والتقارير</h3>
      <div class="command">
        <div class="cmd">/feedback [رسالتك]</div>
        <div class="desc">إرسال مشكلة أو اقتراح (بدون إظهار الاسم، مع وقت الإرسال فقط)</div>
      </div>

      <div class="command">
        <div class="cmd">/sortnames [أسماء]</div>
        <div class="desc">ترتيب فوري للأسماء (يدعم | أو , أو سطر جديد، مع دعم الترقيم)</div>
      </div>

      <div class="command">
        <div class="cmd">/sortnames start ثم add ثم done</div>
        <div class="desc">تجميع أسماء عبر عدة رسائل ثم ترتيبها دفعة واحدة (و /sortnames cancel للإلغاء)</div>
      </div>

      <h3>�📋 إدارة الجلسات</h3>
      <div class="command">
        <div class="cmd">/startlist [اسم]</div>
        <div class="desc">بدء جلسة حضور للطالبات المسجلات</div>
      </div>

      <div class="command">
        <div class="cmd">/starttraininglist [اسم]</div>
        <div class="desc">بدء جلسة حضور في مجموعة التدريب (تستخدم قائمة المجموعة الخاصة)</div>
      </div>

      <div class="command">
        <div class="cmd">/stoplist</div>
        <div class="desc">إنهاء الجلسة الحالية وحفظ السجل</div>
      </div>

      <div class="command">
        <div class="cmd">/status</div>
        <div class="desc">ملخص حالة المجموعة</div>
      </div>

      <div class="command">
        <div class="cmd">/editlist</div>
        <div class="desc">تعديل حالات الحضور للطالبات الفرديات</div>
      </div>

      <div class="command">
        <div class="cmd">/freezelist</div>
        <div class="desc">تجميد تسجيل الحضور مؤقتاً في الجلسة النشطة (في قوائم تصحيح التلاوة يبقى التسجيل الاحتياطي متاحاً بعد التجميد)</div>
      </div>

      <h3>📊 السجلات والتقارير</h3>
      <div class="command">
        <div class="cmd">/classhistory [رقم الدورة]</div>
        <div class="desc">عرض سجل الجلسات (الدورة الحالية افتراضياً، أو يمكن تحديد رقم دورة من الأرشيف: /classhistory 1)</div>
      </div>

      <div class="command">
        <div class="cmd">/studentshistory [رقم الدورة]</div>
        <div class="desc">تقرير لكل طالبة: حضور الحلقة الرئيسية + مجموعة التدريب + آخر آية (الدورة الحالية افتراضياً، أو من الأرشيف: /studentshistory 1)</div>
      </div>

      <div class="command">
        <div class="cmd">/newclass</div>
        <div class="desc">بدء دورة جديدة (يزيد رقم الدورة، والسجلات القديمة تبقى في الأرشيف ولا تُحذف)</div>
      </div>

      <div class="command">
        <div class="cmd">/removeclassrecord [رقم السجل]</div>
        <div class="desc">حذف سجل حلقة من الدورة الحالية (بتأكيد، لمنشئ المجموعة)</div>
      </div>

      <div class="command">
        <div class="cmd">/removestudentrecord [رقم السجل] | [الاسم]</div>
        <div class="desc">حذف سجل طالبة من سجل الدورة الحالية (بتأكيد، لمنشئ المجموعة)</div>
      </div>
    </section>

    <!-- Admin control hub -->
    <section>
      <h2>🗂️ لوحة الإدارة الموحّدة (<code>/manage</code>)</h2>
      <p>تبقى قوائم الحضور الحيّة داخل المجموعة (تضغط عليها الطالبات)، بينما تُدار بقية الأدوات من <strong>لوحة واحدة تُفتح في المحادثة الخاصة مع المشرفة</strong>. أرسلي <code>/manage</code> داخل المجموعة فتصلك اللوحة في الخاص، وتتنقّلين بين الأقسام بالأزرار.</p>

      <div class="command">
        <div class="cmd">/manage</div>
        <div class="desc">لوحة الإدارة الموحّدة (تُفتح بالخاص): الطالبات، طلبات الانضمام، سجل الجلسات، المعلمات، مجموعات التدريب، المواد التعليمية، التكاليف، والصفوف الخاصة</div>
      </div>

      <ul style="margin-left: 2rem;">
        <li><strong>👥 الطالبات</strong> — لوحة <code>/students</code> (إضافة/حذف/تعديل).</li>
        <li><strong>⏳ طلبات الانضمام</strong> — لوحة <code>/pendingstudents</code> (قبول/تجاهل).</li>
        <li><strong>🗂️ سجل الجلسات</strong> — لوحة <code>/classhistory</code> (عرض التقرير أو تعديل السجلات).</li>
        <li><strong>👩‍🏫 المعلمات</strong> — محرّر تفاعلي: إضافة/تعديل الاسم/تغيير النوع/حذف.</li>
        <li><strong>🏷️ مجموعات التدريب</strong> — محرّر تفاعلي: إضافة/إعادة تسمية/حذف/عرض الطالبات.</li>
        <li><strong>📚 المواد التعليمية</strong> — كل درس بعنوان يحمل ملفاً واحداً أو أكثر (مستند/صورة/فيديو/صوت)، مع إضافة ملفات لدرس موجود، ثم إرساله كاملاً إلى المجموعة أو حذفه.</li>
        <li><strong>📓 التكاليف</strong> — متابعة تسليمات الطالبات ومراجعتها في مجموعة التكليف المرتبطة (تُربَط بالأمر <code>/addhomeworkgroup</code>، ويُنشَر التكليف بالوسم <code>#التكليف</code>).</li>
        <li><strong>🧑‍🏫 صفوف بدون مجموعة</strong> — الانتقال إلى صفوفك الخاصة (<code>/offline</code>).</li>
      </ul>

      <div class="workflow">
        <h4>ملاحظة:</h4>
        <p>تُسلَّم لوحات <code>/students</code> و<code>/pendingstudents</code> و<code>/classhistory</code> ولوحة <code>/manage</code> نفسها إلى المحادثة الخاصة مع المشرفة. فإن لم تكن قد بدأت محادثة مع البوت من قبل، ترسل لها المجموعة تنبيهاً بزر لفتح المحادثة.</p>
      </div>
    </section>

    <!-- Offline (DM) classes -->
    <section>
      <h2>🏠 الصفوف الخاصة (بالمحادثة الخاصة مع البوت)</h2>
      <p>يمكن لأي أخت إدارة صفوفها وتسجيل الحضور <strong>بالمحادثة الخاصة مع البوت دون إضافته إلى مجموعة</strong>. كل شيء يُدار بالأزرار، ويبدأ بالأمر <code>/offline</code>.</p>

      <div class="command">
        <div class="cmd">/offline</div>
        <div class="desc">فتح لوحة إدارة صفوفك الخاصة: إنشاء صف، إدارة الطالبات والمعلمات، بدء الجلسات وتسجيل الحضور، وعرض التقارير</div>
      </div>

      <h3>ما الذي يمكن فعله؟</h3>
      <ul style="margin-left: 2rem;">
        <li><strong>إدارة الطالبات:</strong> إضافة، تعديل اسم، أو حذف.</li>
        <li><strong>مجموعات التدريب داخل الصف:</strong> إنشاء مجموعات (تسميات)، تعيين طالبة لمجموعة من قائمتها، وعرض طالبات كل مجموعة.</li>
        <li><strong>إدارة المعلمات:</strong> إضافة معلمة، تعديل اسمها، تغيير نوعها (معلمة الحلقة / التدريب / التلاوة)، أو حذفها.</li>
        <li><strong>الجلسات والتقارير:</strong> بدء الجلسات وتسجيل الحضور وتوليد تقرير لكل جلسة.</li>
        <li><strong>المواد التعليمية:</strong> إضافة ملفات (مستند/صورة/فيديو/صوت) بعنوان، ثم إرسالها إليكِ في المحادثة الخاصة أو حذفها.</li>
        <li><strong>التكاليف:</strong> إنشاء تكليف بعنوان وتسجيل حالة كل طالبة يدوياً (لم تُسلِّم ⬜️ / سلّمت 📝 / صححت ✅).</li>
        <li><strong>تعيين معلمة للجلسة:</strong> من زر «إدارة الجلسة»؛ ويظهر اسم المعلمة المعيّنة أعلى تقرير الجلسة.</li>
      </ul>

      <h3>مشاركة إدارة الصف</h3>
      <p>يمكن للمالكة مشاركة إدارة صفها مع أخوات أخريات بأدوار محدّدة الصلاحيات:</p>
      <div class="session-type">
        <h4>👑 المالكة</h4>
        <p>كل الصلاحيات: إعادة تسمية الصف، إدارة المشرفات وأدوارهنّ، القائمة والمعلمات والجلسات والتقارير.</p>
      </div>
      <div class="session-type">
        <h4>🛠️ المشغِّلة (operator)</h4>
        <p>كل العمليات عدا إعادة تسمية الصف وإدارة المالكة/المشغّلات؛ تشمل إدارة القائمة والمعلمات والجلسات، إضافة/إدارة المساعِدات، ونسخ الصف المشترك إلى صفوفها الخاصة.</p>
      </div>
      <div class="session-type">
        <h4>🤝 المساعِدة (assistant)</h4>
        <p>تعديل الحضور في الجلسات القائمة وعرض التقارير فقط.</p>
      </div>

      <div class="workflow">
        <h4>الدعوة والمشاركة:</h4>
        <ol>
          <li>تُنشئ المالكة أو المشغِّلة «دعوة للانضمام» تحتوي على رابط مباشر للبوت.</li>
          <li>تفتح الأخت المدعوّة الرابط لبدء محادثة مع البوت.</li>
          <li>ثم تختار «🤝 صفوف شاركنني بها» للوصول إلى الصف.</li>
        </ol>
      </div>
    </section>

    <!-- Usage Examples -->
    <section>
      <h2>💡 أمثلة على الاستخدام</h2>

      <h3>مثال 1: بدء جلسة حضور عادية</h3>
      <div class="example">
        <strong>الخطوات:</strong>
        <ol>
          <li>أرسل: <code>/startlist جلسة اليوم</code></li>
          <li>البوت سيعرض لوحة بأسماء الطالبات</li>
          <li>كل طالبة تضغط على أحد الأزرار:
            <ul>
              <li>✅ حاضرة</li>
              <li>👂 مستمعة</li>
              <li>🔔 معتذرة</li>
            </ul>
          </li>
          <li>بعد انتهاء الجلسة، أرسل: <code>/stoplist</code></li>
          <li>السجل سيُحفظ تلقائياً</li>
        </ol>
      </div>

      <h3>مثال 2: إضافة طالبة جديدة</h3>
      <div class="example">
        <strong>الطريقة الموصى بها:</strong>
        <ol>
          <li>المشرفة ترسل: <code>/register</code></li>
          <li>الطالبة تضغط زر <code>طلب التسجيل</code></li>
          <li>المشرفة تراجع الطلبات عبر: <code>/pendingstudents</code> ثم تضغط قبول أو تجاهل</li>
        </ol>
        <p>لا يزال التسجيل اليدوي متاحاً كخيار احتياطي عبر <code>/myid</code>.</p>
        <br>
        <strong>الأمر:</strong> <code>/addstudent 987654321 | فاطمة أحمد</code>
        <p>الرقم <code>987654321</code> هو رقم حساب فاطمة في تيليغرام</p>
        <p>يمكن معرفة رقم الحساب باستخدام: <code>/myid</code></p>
      </div>

      <h3>مثال 3: الوصول إلى السجلات المؤرشفة</h3>
      <div class="example">
        <strong>الخطوات:</strong>
        <ol>
          <li>بعد استخدام <code>/newclass</code> لتبدأ دورة جديدة (الدورة 2)</li>
          <li>للعودة إلى سجلات الدورة السابقة، استخدم: <code>/classhistory 1</code></li>
          <li>أو لإحصائيات الطالبات في الدورة 1: <code>/studentshistory 1</code></li>
          <li>البيانات القديمة لا تُحذف بل تُحفظ في الأرشيف</li>
        </ol>
      </div>

      <h3>مثال 3: إضافة طالبة جديدة</h3>
      <div class="example">
        <strong>الخطوات:</strong>
        <ol>
          <li>أرسل: <code>/startpersonalrecitation ختمة فردية</code></li>
          <li>البوت سيعيّن لكل طالبة الصفحة التالية من آخر صفحة وصلت إليها</li>
          <li>الطالبات يحضرون ويقرأون</li>
          <li>استخدم <code>/editlist</code> لتحديث الصفحات إن لزم الأمر</li>
          <li>أرسل: <code>/stoplist</code></li>
        </ol>
      </div>

      <h3>مثال 4: الإعلانات للمعلمات</h3>
      <div class="example">
        <strong>لإعلان جميع معلمات التلاوة:</strong><br>
        <code>/tagteachers recitationteacher</code>
        <p>البوت سيذكر جميع معلمات التلاوة بالاسم في المجموعة 🎙️</p>
      </div>
    </section>

    <!-- Status Definitions -->
    <section>
      <h2>📌 حالات الحضور</h2>
      <div class="grid">
        <div class="card">
          <h4>✅ حاضرة</h4>
          <p>الطالبة حاضرة وشاركت بنشاط في الجلسة.</p>
        </div>
        <div class="card">
          <h4>👂 مستمعة</h4>
          <p>الطالبة حاضرة لكنها لم تشارك بشكل مباشر.</p>
        </div>
        <div class="card">
          <h4>🔔 معتذرة</h4>
          <p>الطالبة أبلغت مسبقاً عن عدم القدرة على الحضور.</p>
        </div>
        <div class="card">
          <h4>❌ غياب</h4>
          <p>الطالبة لم تحضر ولم تبلغ عن عذر.</p>
        </div>
      </div>
    </section>

    <!-- Tips -->
    <section>
      <h2>💡 نصائح وتلميحات</h2>
      <ul style="margin-left: 2rem;">
        <li><strong>رقم الحساب في تيليغرام:</strong> استخدم <code>/myid</code> في أي محادثة خاصة مع البوت لمعرفة رقمك</li>
        <li><strong>التسجيل الأسهل:</strong> أرسل <code>/register</code> داخل المجموعة ليظهر زر الطلب، ثم راجع الطلبات عبر <code>/pendingstudents</code></li>
        <li><strong>الترتيب التلقائي:</strong> استخدم <code>/sortnames [أسماء]</code> للفرز الفوري، أو <code>/sortnames start</code> ثم <code>add</code> ثم <code>done</code> للتجميع</li>
        <li><strong>سجلات الدورات:</strong> كل دورة لها سجلات منفصلة. استخدم <code>/newclass</code> للبدء بدورة جديدة، والبيانات القديمة تبقى في الأرشيف</li>
        <li><strong>الوصول للأرشيف:</strong> استخدم <code>/classhistory 1</code> أو <code>/studentshistory 1</code> للوصول إلى سجلات الدورات السابقة (لا شيء يُحذف!)</li>
        <li><strong>الحفظ التلقائي:</strong> جميع البيانات تُحفظ تلقائياً عند إنهاء الجلسة</li>
        <li><strong>الصفحات:</strong> في الختمات الفردية والجماعية، يمكنك تعديل الصفحات يدوياً باستخدام <code>/editlist</code></li>
        <li><strong>المعلمات:</strong> استخدم <code>/addteacher</code> لإضافة معلمات بأنواع مختلفة (courseteacher, trainingteacher, recitationteacher) ثم استخدم <code>/tagteachers</code> للإشارة إليهن</li>
      </ul>
    </section>

    <!-- FAQ -->
    <section>
      <h2>❓ الأسئلة الشائعة</h2>
      
      <h3>كيف أحصل على رقم حسابي في تيليغرام؟</h3>
      <p>افتح محادثة خاصة مع البوت وأرسل <code>/myid</code>. سيرد عليك برقم حسابك.</p>

      <h3>ما أفضل طريقة لتسجيل الطالبات الآن؟</h3>
      <p>الطريقة الموصى بها: المشرفة ترسل <code>/register</code> داخل المجموعة، الطالبات يضغطن زر الطلب، ثم تراجعين الطلبات من <code>/pendingstudents</code>. ما زال <code>/myid</code> متاحاً كخيار احتياطي.</p>

      <h3>هل يمكن استخدام البوت في عدة مجموعات؟</h3>
      <p>نعم! لكل مجموعة قائمتها وسجلاتها الخاصة.</p>

      <h3>ماذا يحدث عند استخدام /newclass؟</h3>
      <p>يتم زيادة رقم الدورة (مثلاً من 1 إلى 2)، والسجلات القديمة تبقى في الأرشيف ولا تُحذف. يمكن الوصول إليها لاحقاً باستخدام <code>/classhistory 1</code> أو <code>/studentshistory 1</code>.</p>

      <h3>كيف أسترجع سجلات الدورات القديمة؟</h3>
      <p>استخدم <code>/classhistory [رقم الدورة]</code> أو <code>/studentshistory [رقم الدورة]</code>. مثال: <code>/classhistory 1</code> يعرض جميع جلسات الدورة الأولى، و<code>/studentshistory 2</code> يعرض إحصائيات الطالبات في الدورة الثانية.</p>

      <h3>هل يمكن تعديل الحضور بعد إنهاء الجلسة؟</h3>
      <p>نعم. أثناء أي جلسة نشطة استخدم <code>/editlist</code>. وبعد إنهاء الجلسة بـ <code>/stoplist</code> يمكنك تعديل السجل المؤرشف من <code>/classhistory</code> ← «تعديل السجلات»: تغيير حالة الحضور لكل طالبة، وتعديل الآيات في قوائم تصحيح التلاوة، إضافةً إلى حقلَي «حضور الحلقة الأساسية» و«الاحتياط».</p>

      <h3>ماذا يحدث لو ضغطت طالبة غير مسجّلة زر الحضور؟</h3>
      <p>في قوائم الحضور المرتبطة بقائمة الطالبات (الرئيسية والتدريب وتصحيح التلاوة) تُحتسب الضيفة حاضرةً مباشرةً في الجلسة، وتُضاف كطلب تسجيل معلّق تعتمده المشرفة لاحقاً من <code>/pendingstudents</code> (الاعتماد يضيفها إلى قائمة المجموعة، وفي جلسات التدريب يُضاف اسمها كذلك إلى المجموعة الرئيسية المرتبطة). أمّا القوائم المفتوحة وجلسات الختمة فتُضيف الضيفة إلى القائمة مباشرةً دون اعتماد.</p>

      <h3>ما الفرق بين الختمة الفردية والجماعية؟</h3>
      <p><strong>الفردية:</strong> كل طالبة لديها ختمتها الخاصة، تستأنف من الصفحة التي توقفت عندها في آخر جلسة</p>
      <p><strong>الجماعية:</strong> ختمة واحدة موحدة يقرأها الجميع بالتسلسل—كل طالبة تقرأ صفحة واحدة، والجلسة التالية تستأنف من آخر صفحة تم قراءتها</p>
    </section>

    <!-- Telegram Profile Guide -->
    <section>
      <h2>📱 دليل تغيير اسم الملف الشخصي في تيليغرام</h2>
      <p style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
        <strong>💡 للمستخدمات الكبيرات في السن:</strong> شاهدي هذا الفيديو بعناية. يوضح كل خطوة بالضبط كما ستفعلينها على هاتفك.
      </p>

      <h3>🎥 شاهدي الفيديو التوضيحي</h3>
      <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; text-align: center;">
        <iframe 
          width="100%" 
          height="600" 
          src="https://www.youtube.com/embed/CY7Cx-UHW38" 
          title="شرح تغيير اسم الملف الشخصي في تيليغرام"
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          allowfullscreen
          style="border-radius: 8px;">
        </iframe>
        <p style="margin-top: 1rem; color: #666; font-size: 0.9rem;">
          👆 اضغطي على الفيديو لمشاهدته بحجم أكبر. يمكنك إيقافه والرجوع خطوة للخلف عند الحاجة.
        </p>
      </div>

      <h3>📝 الخطوات المختصرة (للمراجعة السريعة)</h3>
      <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 1.5rem; border-radius: 4px; margin: 1rem 0;">
        <ol style="margin-left: 1.5rem;">
          <li><strong>افتحي تيليغرام</strong> من شاشة هاتفك الرئيسية (الأيقونة الزرقاء)</li>
          <li><strong>اضغطي على الملف الشخصي</strong> 👤 في الأسفل على اليسار</li>
          <li><strong>اضغطي على "تعديل الملف"</strong> الزر الأزرق</li>
          <li><strong>امسحي الاسم القديم</strong> من حقل "الاسم الأول"</li>
          <li><strong>اكتبي الاسم الجديد</strong> الذي تريدينه</li>
          <li><strong>اضغطي "حفظ"</strong> الزر الأخضر في الأسفل</li>
          <li><strong>تم! ✅</strong> اسمك الجديد محفوظ</li>
        </ol>
      </div>

      <h3>❓ نصائح مهمة</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div class="card" style="background: #f0f4ff; border-top: 4px solid #667eea;">
          <h4>✏️ يمكنك تغيير الاسم</h4>
          <p>في أي وقت تريدين!</p>
        </div>
        <div class="card" style="background: #f0f4ff; border-top: 4px solid #667eea;">
          <h4>👤 الاسم خاص بك</h4>
          <p>لا أحد يراه سوى أصدقاؤك في تيليغرام</p>
        </div>
        <div class="card" style="background: #f0f4ff; border-top: 4px solid #667eea;">
          <h4>🔤 اختاري اسم واضح</h4>
          <p>يتعرّف به أصدقاؤك عليك</p>
        </div>
        <div class="card" style="background: #f0f4ff; border-top: 4px solid #667eea;">
          <h4>📱 تطبيق واحد</h4>
          <p>هذه التعديلات لا تؤثر على البرامج الأخرى</p>
        </div>
      </div>

      <h3>🆘 إذا واجهتِ مشكلة</h3>
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 1.5rem; border-radius: 4px;">
        <p><strong>🔄 إذا لم يحفظ التعديل:</strong></p>
        <ol style="margin-left: 1.5rem; margin-top: 0.5rem;">
          <li>تأكدي من اتصالك بالإنترنت</li>
          <li>جربي إغلاق التطبيق وفتحه مرة أخرى</li>
          <li>قد يأخذ وقت ليحدّث الآخرون اسمك الجديد (ساعة أو ساعتين)</li>
        </ol>
        <p style="margin-top: 1rem;"><strong>💬 تحتاجين مساعدة؟</strong> استخدمي الأمر <code>/feedback</code> لإرسال رسالة دعم.</p>
      </div>
    </section>
    </section>

    <!-- Support -->
    <section>
      <h2>🆘 الدعم والمساعدة</h2>
      <p>إذا واجهت أي مشاكل أو لديك اقتراحات:</p>
      <ul style="margin-left: 2rem;">
        <li><strong>الإبلاغ عن مشاكل:</strong> استخدم الأمر <code>/feedback [وصف المشكلة]</code> لإرسال تقرير مجهول الهوية</li>
        <li><strong>أمثلة مفيدة للتقرير:</strong>
          <ul>
            <li><code>/feedback عند استخدام /editlist، حالة الحضور لا تُحفظ</code></li>
            <li><code>/feedback /startlist لا يعرض أزرار الحضور في الرسالة</code></li>
          </ul>
        </li>
        <li><strong>نصيحة:</strong> اذكر الأمر المستخدم والمشكلة والسلوك المتوقع لتسهيل حل المشكلة</li>
      </ul>
      <p style="margin-top: 1rem; color: #999; font-size: 0.9rem;">آخر تحديث: يوليو 2026</p>
    </section>
  </div>

  <footer>
    <p>📱 Deen Circles Attendance Bot | بوت إدارة الحضور والتسجيل</p>
    <p>جميع الحقوق محفوظة © 2026</p>
  </footer>
</body>
</html>`;

export default async (req, res) => {
  if (req.method !== 'POST') {
    // Serve HTML documentation for GET requests
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(HTML_DOCS);
  }
  // Optional shared-secret check (set the same value when registering the webhook).
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('unauthorized');
  }

  const updateId = Number.isInteger(req.body?.update_id) ? req.body.update_id : null;
  let beganProcessing = false;
  if (updateId !== null) {
    try {
      const staleMs = Number(process.env.UPDATE_PROCESSING_STALE_MS || 120000);
      const begin = await storage.beginUpdateProcessing(updateId, Number.isFinite(staleMs) ? staleMs : 120000);
      if (!begin?.shouldProcess) {
        return res.status(200).send('ok');
      }
      beganProcessing = true;
    } catch (e) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'webhook_begin_processing_failed',
        updateId,
        message: e?.message || String(e),
        at: new Date().toISOString(),
      }));
      // Continue handling to avoid dropping updates if idempotency layer has transient issues.
    }
  }

  try {
    await bot.handleUpdate(req.body);
    if (beganProcessing && updateId !== null) {
      await storage.completeUpdateProcessing(updateId);
    }
  } catch (e) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'webhook_handle_update_failed',
      updateId,
      message: e?.message || String(e),
      at: new Date().toISOString(),
    }));
    if (beganProcessing && updateId !== null) {
      try {
        await storage.failUpdateProcessing(updateId, e?.message || String(e));
      } catch (failErr) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'webhook_mark_failed_update_failed',
          updateId,
          message: failErr?.message || String(failErr),
          at: new Date().toISOString(),
        }));
      }
    }
  }
  res.status(200).send('ok');
};

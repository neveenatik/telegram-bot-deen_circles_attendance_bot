// Vercel serverless webhook endpoint for Telegram.
// Telegram POSTs updates here; we hand each one to the bot.
import bot from '../index.js';

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
          <li>استخدم <code>/students</code> لإدارة قائمة الطالبات</li>
          <li>استخدم <code>/addstudent [معرّف] | [اسم]</code> لإضافة طالبات</li>
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
        <h4>🎯 قائمة ثانوية <span class="badge">للمسجلات فقط</span></h4>
        <p><strong>الأمر:</strong> <code>/startsecondarylist [اسم]</code></p>
        <p>لحلقات تصحيح التلاوة أو برامج إضافية.</p>
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
        <div class="cmd">/students</div>
        <div class="desc">عرض قائمة الطالبات مع خيارات إضافة/حذف/تعديل</div>
      </div>

      <div class="command">
        <div class="cmd">/addstudent [معرّف] | [اسم]</div>
        <div class="desc">إضافة طالبة أو أكثر — يمكن فصل الإدخالات بسطر جديد أو فاصلة</div>
      </div>

      <div class="command">
        <div class="cmd">/removestudent [اسم]</div>
        <div class="desc">حذف طالبة أو أكثر — يمكن فصل الأسماء بسطر جديد أو فاصلة</div>
      </div>

      <div class="command">
        <div class="cmd">/renamestudent [قديم] | [جديد]</div>
        <div class="desc">تعديل اسم طالبة أو أكثر — سطر جديد لكل إدخال</div>
      </div>

      <h3>🎤 إدارة المعلمات</h3>
      <div class="command">
        <div class="cmd">/addteacher [معرّف] | [اسم] | [نوع]</div>
        <div class="desc">إضافة معلمة أو أكثر (سطر لكل إدخال) — الأنواع: courseteacher, trainingteacher, recitationteacher</div>
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
        <div class="desc">الإشارة إلى المعلمات حسب النوع (courseteacher | trainingteacher | recitationteacher)</div>
      </div>

      <h3>� التواصل والتقارير</h3>
      <div class="command">
        <div class="cmd">/feedback [رسالتك]</div>
        <div class="desc">الإبلاغ عن مشاكل تقنية أو اقتراحات (يتم الإرسال بشكل مجهول الهوية مع طابع التاريخ فقط)</div>
      </div>

      <h3>�📋 إدارة الجلسات</h3>
      <div class="command">
        <div class="cmd">/startlist [اسم]</div>
        <div class="desc">بدء جلسة حضور للطالبات المسجلات</div>
      </div>

      <div class="command">
        <div class="cmd">/stoplist</div>
        <div class="desc">إنهاء الجلسة الحالية وحفظ السجل</div>
      </div>

      <div class="command">
        <div class="cmd">/status</div>
        <div class="desc">عرض ملخص الجلسة الحالية</div>
      </div>

      <div class="command">
        <div class="cmd">/editlist</div>
        <div class="desc">تعديل حالات الحضور للطالبات الفرديات</div>
      </div>

      <h3>📊 السجلات والتقارير</h3>
      <div class="command">
        <div class="cmd">/classhistory [رقم الدورة]</div>
        <div class="desc">عرض سجل الجلسات (الدورة الحالية افتراضياً، أو يمكن تحديد رقم دورة من الأرشيف: /classhistory 1)</div>
      </div>

      <div class="command">
        <div class="cmd">/studentshistory [رقم الدورة]</div>
        <div class="desc">إحصائيات الحضور لكل طالبة (الدورة الحالية افتراضياً، أو من أرشيف السابق: /studentshistory 1)</div>
      </div>

      <div class="command">
        <div class="cmd">/newclass</div>
        <div class="desc">بدء دورة جديدة (يزيد رقم الدورة، والسجلات القديمة تبقى في الأرشيف ولا تُحذف)</div>
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
        <strong>الأمر:</strong> <code>/addstudent 987654321 | فاطمة أحمد</code>
        <p>حيث <code>987654321</code> هو معرّف التيليغرام الخاص بفاطمة</p>
        <p>يمكن الحصول على المعرّف باستخدام: <code>/myid</code></p>
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
        <li><strong>معرّف التيليغرام:</strong> استخدم <code>/myid</code> في أي محادثة خاصة مع البوت للحصول على معرفك</li>
        <li><strong>الترتيب التلقائي:</strong> استخدم <code>/sortnames [أسماء]</code> لترتيب القائمة أبجدياً</li>
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
      
      <h3>كيف أحصل على معرّف التيليغرام؟</h3>
      <p>افتح محادثة خاصة مع البوت وأرسل <code>/myid</code>. سيرد لك بمعرّفك.</p>

      <h3>هل يمكن استخدام البوت في عدة مجموعات؟</h3>
      <p>نعم! لكل مجموعة قائمتها وسجلاتها الخاصة.</p>

      <h3>ماذا يحدث عند استخدام /newclass؟</h3>
      <p>يتم زيادة رقم الدورة (مثلاً من 1 إلى 2)، والسجلات القديمة تبقى في الأرشيف ولا تُحذف. يمكن الوصول إليها لاحقاً باستخدام <code>/classhistory 1</code> أو <code>/studentshistory 1</code>.</p>

      <h3>كيف أسترجع سجلات الدورات القديمة؟</h3>
      <p>استخدم <code>/classhistory [رقم الدورة]</code> أو <code>/studentshistory [رقم الدورة]</code>. مثال: <code>/classhistory 1</code> يعرض جميع جلسات الدورة الأولى، و<code>/studentshistory 2</code> يعرض إحصائيات الطالبات في الدورة الثانية.</p>

      <h3>هل يمكن تعديل الحضور بعد إنهاء الجلسة؟</h3>
      <p>يمكنك تعديل الحضور باستخدام <code>/editlist</code> أثناء أي جلسة نشطة. بعد إنهاء الجلسة بـ <code>/stoplist</code>، لا يمكن تعديل السجل مباشرة. للاحتياط، تأكد من صحة البيانات قبل إنهاء الجلسة.</p>

      <h3>ما الفرق بين الختمة الفردية والجماعية؟</h3>
      <p><strong>الفردية:</strong> كل طالبة لديها ختمتها الخاصة، تستأنف من الصفحة التي توقفت عندها في آخر جلسة</p>
      <p><strong>الجماعية:</strong> ختمة واحدة موحدة يقرأها الجميع بالتسلسل—كل طالبة تقرأ صفحة واحدة، والجلسة التالية تستأنف من آخر صفحة تم قراءتها</p>
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
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error('handleUpdate error:', e?.message);
  }
  res.status(200).send('ok');
};

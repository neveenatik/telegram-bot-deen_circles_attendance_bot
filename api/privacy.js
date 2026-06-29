export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>سياسة الخصوصية</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      line-height: 1.8;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 2px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 20px;
    }
    p {
      margin: 10px 0;
    }
    .section {
      background: white;
      padding: 15px;
      margin: 15px 0;
      border-radius: 5px;
      border-right: 3px solid #3498db;
    }
  </style>
</head>
<body>
  <h1>🔒 سياسة الخصوصية</h1>
  
  <div class="section">
    <h2>البيانات المجمعة</h2>
    <p>يجمع البوت المعلومات التالية:</p>
    <ul>
      <li>أسماء الأعضاء المسجلين</li>
      <li>معرفات Telegram (User ID)</li>
      <li>سجلات الحضور والاعتذارات</li>
      <li>سجل الجلسات الدراسية</li>
    </ul>
  </div>

  <div class="section">
    <h2>كيفية استخدام البيانات</h2>
    <p>تُستخدم البيانات حصراً لـ:</p>
    <ul>
      <li>تسجيل وتتبع حضور أعضاء الحلقات</li>
      <li>توليد تقارير الحضور التاريخية</li>
      <li>إدارة قوائم الأعضاء</li>
    </ul>
  </div>

  <div class="section">
    <h2>تخزين البيانات</h2>
    <p>تُخزّن البيانات في <strong>Supabase</strong> (خادم آمن معتمد) مع تشفير وحماية عالية.</p>
  </div>

  <div class="section">
    <h2>المشاركة مع أطراف ثالثة</h2>
    <p>❌ <strong>لا نشارك البيانات</strong> مع أي جهات خارجية أو تطبيقات أخرى.</p>
  </div>

  <div class="section">
    <h2>حقوق المستخدم</h2>
    <p>يمكنك طلب:</p>
    <ul>
      <li>عرض بياناتك</li>
      <li>تعديل معلوماتك</li>
      <li>حذف بياناتك بالكامل</li>
    </ul>
    <p>للطلب، تواصل مع مشرف المجموعة.</p>
  </div>

  <div class="section">
    <h2>التحديثات</h2>
    <p>قد نحدث هذه السياسة في أي وقت. آخر تحديث: 2026</p>
  </div>
</body>
</html>
  `);
}

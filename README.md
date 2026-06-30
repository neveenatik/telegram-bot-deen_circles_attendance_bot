# بوت الحضور – Telegram Attendance Bot

بوت تيليغرام بالعربية لتسجيل الحضور وتتبع الغيابات.

يدعم العمل محلياً باستخدام ملفات JSON، ويدعم النشر على Vercel مع Supabase في الإنتاج.

## المتطلبات

- Node.js 18+
- حساب بوت على Telegram عبر [@BotFather](https://t.me/BotFather)
- حساب Supabase إذا كنت ستنشر على Vercel
- يجب إضافة البوت إلى مجموعة Telegram واستخدام صلاحيات المشرف المدمجة في Telegram للتحكم بالأوامر الإدارية.

## الإعداد

```bash
# 1. انسخ المستودع وادخل المجلد
cd telegram-bot

# 2. ثبّت الحزم
npm install

# 3. أنشئ ملف .env من القالب
cp .env.example .env

# 4. عدّل .env وأضف القيم المطلوبة
#    BOT_TOKEN=                 ← من @BotFather
#    SUPABASE_URL=              ← Project URL من Supabase
#    SUPABASE_SERVICE_ROLE_KEY= ← service_role secret من Supabase
#    WEBHOOK_SECRET=            ← قيمة عشوائية اختيارية للأمان

# 5. أضف البوت إلى المجموعة وامنحه صلاحية المشرف
#    الأوامر الإدارية تعمل فقط داخل المجموعة ومن المشرفين في Telegram

# 6. شغّل البوت
npm start
```

## النشر على Vercel + Supabase

إذا أردت تشغيل البوت على Vercel بدل التشغيل المحلي، اتبع الخطوات التالية:

1. أنشئ مشروعاً جديداً في Supabase.
2. نفّذ ملف [supabase.sql](supabase.sql) داخل SQL Editor لإنشاء جدول `kv`.
3. انسخ `SUPABASE_URL` من الصفحة الرئيسية للمشروع في Supabase.
4. انسخ `SUPABASE_SERVICE_ROLE_KEY` من Settings → API → Legacy anon, service_role API keys.
5. ارفع المشروع إلى GitHub ثم اربطه مع Vercel.
6. أضف متغيرات البيئة في Vercel:
    - `BOT_TOKEN`
    - `SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `WEBHOOK_SECRET` إذا كنت تستخدم التحقق من webhook
7. بعد النشر، سجّل قائمة أوامر Telegram حتى يظهر autocomplete عند كتابة `/`:

```bash
npm run set-commands
```

8. بعد ذلك اضبط webhook عبر:

```bash
npm run set-webhook -- https://your-project.vercel.app/api/telegram
```

أو استبدل الرابط برابط النشر الفعلي الخاص بك.

ملاحظة: عند وجود `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` سيستخدم البوت Supabase تلقائياً، وإلا سيعود إلى التخزين المحلي داخل مجلد `data/`.

## الأوامر

### أوامر الأعضاء
| الأمر | الوصف |
|-------|-------|
| `/myid` | عرض معرّف حسابك على Telegram لإرساله للمشرف |

### أوامر المشرف فقط
| الأمر | الوصف |
|-------|-------|
| `/start` | رسالة الترحيب وقائمة الأوامر |
| `/status` | ملخص سريع لحالة الجلسة |
| `/members` | واجهة إدارة الأعضاء (إضافة / حذف / تعديل) |
| `/registerinfo` | إرسال شرح طريقة التسجيل إلى المجموعة |
| `/sortnames [اسم1 | اسم2 | ...]` | ترتيب قائمة أسماء أبجدياً (يدعم الفواصل `|` أو `,` أو كل اسم في سطر، ويدعم الترقيم مثل `1-`) |
| `/startsession [اسم الحلقة]` | بدء جلسة حضور جديدة |
| `/startopensession [اسم الحلقة]` | بدء جلسة مفتوحة لأي عضوة |
| `/stopregistration` | إيقاف تسجيل الحضور أثناء الجلسة |
| `/resetseries` | محو السلسلة الحالية والبدء بسلسلة جديدة (لمنشئ المجموعة) |
| `/records` | عرض سجلات السلسلة الحالية مع رقم كل سجل |
| `/removerecord [رقم السجل]` | حذف سجل جلسة من السلسلة الحالية (يتطلب تأكيد، لمنشئ المجموعة) |
| `/removememberrecord [رقم السجل] | [الاسم]` | حذف سجل عضو من جلسة في السلسلة الحالية (يتطلب تأكيد، لمنشئ المجموعة) |
| `/clearrecords` | حذف جميع السجلات المؤرشفة (يتطلب تأكيد، لمنشئ المجموعة) |
| `/endsession` | إنهاء الجلسة وعرض التقرير الكامل |
| `/sessionmanage` | تعديل حالة أي عضو يدوياً |
| `/history` | عرض سجل الجلسات السابقة |
| `/addmember [معرّف] | [الاسم]` | إضافة عضو وربطه بمعرّف Telegram |
| `/removemember [الاسم]` | حذف عضو من القائمة |
| `/renamemember [قديم] | [جديد]` | تعديل اسم العرض للعضو مع إبقاء الربط نفسه |

## البنية

```
telegram-bot/
├── index.js              ← كود البوت الرئيسي
├── package.json
├── vercel.json           ← إعدادات نشر Vercel
├── api/
│   └── telegram.js       ← endpoint webhook الخاص بـ Telegram
├── scripts/
│   └── set-webhook.js    ← ضبط webhook بعد النشر
├── .env                  ← (تُنشأ محلياً، غير محفوظة في git)
├── .env.example          ← القالب
├── supabase.sql          ← إنشاء جدول التخزين في Supabase
└── data/
    ├── masterList.json   ← قائمة الأعضاء المسجّلين
    ├── currentSession.json ← الجلسة النشطة حالياً
    └── sessions.json     ← سجل الجلسات السابقة (في .gitignore)
```

## سير العمل المعتاد

1. المشرف يطلب من العضو تنفيذ `/myid` لإرسال معرّفه.
2. المشرف يضيف العضو: `/addmember 123456789 | أحمد محمد`
3. المشرف يبدأ حلقة: `/startsession اجتماع يونيو`
4. الأعضاء يسجّلون حضورهم من واجهة الأزرار: حاضر / مستمع / غير قادر.
5. المشرف يراجع الحالات من `/status` أو من واجهة `/sessionmanage`.
6. المشرف ينهي الحلقة: `/endsession` ← يتم تعطيل الواجهة وتوليد التقرير النهائي

// SVG Graphics for Telegram Profile Guide
// All SVGs with Arabic text and proper styling

export const svgs = {
  // Image 1: Home Screen with App Icons
  homeScreen: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .phone-bg { fill: white; }
        .app-icon { fill: #f0f0f0; stroke: #ccc; stroke-width: 2; }
        .app-icon-telegram { fill: #c8e6ff; stroke: #0088cc; stroke-width: 3; }
        .highlight-circle { fill: none; stroke: #ff0000; stroke-width: 4; }
        .guide-text { font-family: Arial, sans-serif; font-size: 20px; font-weight: bold; fill: #ff0000; }
        .emoji-text { font-size: 48px; }
        .arrow-line { stroke: #ff0000; stroke-width: 4; fill: none; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="phone-bg" width="540" height="1080"/>
    
    <!-- Top status bar -->
    <rect fill="#f9f9f9" width="540" height="40"/>
    <text x="20" y="28" font-size="14" fill="#999">9:41</text>
    
    <!-- App Grid -->
    <!-- Row 1 -->
    <g>
      <rect class="app-icon" x="40" y="80" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="70" y="155">📧</text>
    </g>
    
    <g>
      <rect class="app-icon" x="225" y="80" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="255" y="155">📸</text>
    </g>
    
    <g>
      <rect class="app-icon" x="410" y="80" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="440" y="155">📱</text>
    </g>
    
    <!-- Row 2 - Telegram highlighted -->
    <g>
      <rect class="app-icon-telegram" x="40" y="220" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="70" y="295">💬</text>
      <circle class="highlight-circle" cx="85" cy="265" r="65"/>
    </g>
    
    <g>
      <rect class="app-icon" x="225" y="220" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="255" y="295">📖</text>
    </g>
    
    <g>
      <rect class="app-icon" x="410" y="220" width="90" height="90" rx="12"/>
      <text class="emoji-text" x="440" y="295">⚙️</text>
    </g>
    
    <!-- Arrow pointing down to Telegram -->
    <line class="arrow-line" x1="270" y1="160" x2="270" y2="210"/>
    <polygon points="270,210 260,190 280,190" fill="#ff0000"/>
    
    <!-- Guide text -->
    <text class="guide-text" x="20" y="450">ابحثي عن هذه الأيقونة</text>
    <text class="guide-text" x="20" y="480">الزرقاء 👇</text>
  </svg>`,

  // Image 2: App Loading
  appLoading: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .logo-circle { fill: #0088cc; }
        .logo-text { font-size: 72px; }
        .app-name { font-family: Arial, sans-serif; font-size: 32px; font-weight: bold; fill: #0088cc; }
        .loading-text { font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; fill: #4CAF50; }
        .bar-outline { fill: none; stroke: #0088cc; stroke-width: 3; }
        .bar-fill { fill: #0088cc; animation: load 2s infinite; }
        @keyframes load { from { width: 0; } to { width: 300px; } }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Logo Circle -->
    <circle class="logo-circle" cx="270" cy="350" r="80"/>
    <text class="logo-text" x="240" y="390">✈️</text>
    
    <!-- App Name -->
    <text class="app-name" x="270" y="480" text-anchor="middle">Telegram</text>
    
    <!-- Loading Bar -->
    <rect class="bar-outline" x="120" y="550" width="300" height="20" rx="10"/>
    <rect class="bar-fill" x="120" y="550" width="70" height="20" rx="10"/>
    
    <!-- Status Text -->
    <text class="loading-text" x="270" y="650" text-anchor="middle">جاري فتح التطبيق...</text>
    <text class="loading-text" x="270" y="690" text-anchor="middle" fill="#4CAF50">✓ نجح!</text>
  </svg>`,

  // Image 3: Main Chat Screen
  mainScreen: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .nav-bar { fill: white; stroke: #eee; stroke-width: 1; }
        .nav-icon { font-size: 24px; }
        .nav-active { fill: #0088cc; }
        .chat-item { fill: white; stroke: #eee; stroke-width: 1; }
        .avatar { fill: #0088cc; }
        .chat-name { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: #333; }
        .chat-msg { font-family: Arial, sans-serif; font-size: 13px; fill: #999; }
        .highlight-circle { fill: none; stroke: #ff0000; stroke-width: 3; }
        .guide-text { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #ff0000; }
        .arrow-line { stroke: #ff0000; stroke-width: 3; fill: none; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Top bar -->
    <rect fill="#f9f9f9" width="540" height="50" stroke="#eee" stroke-width="1"/>
    <text class="chat-name" x="20" y="35">الرسائل</text>
    
    <!-- Chat Items -->
    <g class="chat-item">
      <rect y="50" width="540" height="80" fill="white" stroke="#eee" stroke-width="1"/>
      <circle class="avatar" cx="490" cy="90" r="30"/>
      <text class="chat-name" x="20" y="80">مريم محمد</text>
      <text class="chat-msg" x="20" y="110">آخر رسالة...</text>
    </g>
    
    <g class="chat-item">
      <rect y="130" width="540" height="80" fill="white" stroke="#eee" stroke-width="1"/>
      <circle class="avatar" cx="490" cy="170" r="30"/>
      <text class="chat-name" x="20" y="160">فاطمة أحمد</text>
      <text class="chat-msg" x="20" y="190">آخر رسالة...</text>
    </g>
    
    <g class="chat-item">
      <rect y="210" width="540" height="80" fill="white" stroke="#eee" stroke-width="1"/>
      <circle class="avatar" cx="490" cy="250" r="30"/>
      <text class="chat-name" x="20" y="240">عائشة علي</text>
      <text class="chat-msg" x="20" y="270">آخر رسالة...</text>
    </g>
    
    <g class="chat-item">
      <rect y="290" width="540" height="80" fill="white" stroke="#eee" stroke-width="1"/>
      <circle class="avatar" cx="490" cy="330" r="30"/>
      <text class="chat-name" x="20" y="320">لمياء حسن</text>
      <text class="chat-msg" x="20" y="350">آخر رسالة...</text>
    </g>
    
    <!-- Navigation Bar -->
    <rect class="nav-bar" y="950" width="540" height="130"/>
    <g text-anchor="middle">
      <text class="nav-icon" x="100" y="1000">💬</text>
      <text class="nav-icon" x="200" y="1000">📞</text>
      <text class="nav-icon" x="300" y="1000">🔍</text>
      
      <!-- Profile icon with highlight -->
      <circle class="highlight-circle" cx="440" cy="1015" r="40"/>
      <text class="nav-icon nav-active" x="440" y="1000">👤</text>
    </g>
    
    <!-- Arrow pointing to profile -->
    <line class="arrow-line" x1="380" y1="880" x2="420" y2="950"/>
    <polygon points="420,950 410,925 430,935" fill="#ff0000"/>
    
    <!-- Guide text -->
    <text class="guide-text" x="20" y="520">هنا ملفك الشخصي</text>
  </svg>`,

  // Image 4: Profile Page
  profilePage: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .header { fill: #0088cc; }
        .profile-pic { fill: #8ab4f8; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .text-value { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: #333; }
        .button { fill: #0088cc; stroke: none; }
        .button-text { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: white; }
        .stat-value { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #0088cc; }
        .stat-label { font-family: Arial, sans-serif; font-size: 12px; fill: #999; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Header -->
    <rect class="header" width="540" height="60"/>
    <text class="button-text" x="20" y="40">← الملف الشخصي</text>
    
    <!-- Profile Picture -->
    <circle class="profile-pic" cx="270" cy="140" r="60"/>
    <text style="font-size: 48px; text-anchor: middle;" x="270" y="150">👩</text>
    
    <!-- Name Section -->
    <text class="text-label" x="40" y="240">الاسم</text>
    <text class="text-value" x="40" y="270">أم فاطمة محمد</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="280" x2="500" y2="280"/>
    
    <!-- Username Section -->
    <text class="text-label" x="40" y="320">معرّف المستخدم</text>
    <text class="text-value" x="40" y="350">@umfatima2024</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="360" x2="500" y2="360"/>
    
    <!-- Stats -->
    <g text-anchor="middle">
      <text class="stat-value" x="135" y="440">145</text>
      <text class="stat-label" x="135" y="460">جهات اتصال</text>
      
      <text class="stat-value" x="270" y="440">89</text>
      <text class="stat-label" x="270" y="460">مجموعات</text>
      
      <text class="stat-value" x="405" y="440">342</text>
      <text class="stat-label" x="405" y="460">رسائل</text>
    </g>
    
    <!-- About Section -->
    <text class="text-label" x="40" y="520">نبذة</text>
    <text class="text-value" x="40" y="550">طالبة علم، أم، ومعلمة قرآن</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="560" x2="500" y2="560"/>
    
    <!-- Edit Button -->
    <rect class="button" x="120" y="650" width="300" height="50" rx="8"/>
    <text class="button-text" x="270" y="682" text-anchor="middle">✏️ تعديل الملف</text>
  </svg>`,

  // Image 5: Edit Profile Form
  editForm: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .header { fill: #0088cc; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .input-field { fill: #f5f5f5; stroke: #ddd; stroke-width: 2; }
        .input-text { font-family: Arial, sans-serif; font-size: 16px; fill: #333; }
        .button { fill: #0088cc; stroke: none; }
        .button-text { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: white; }
        .arrow { stroke: #ff0000; stroke-width: 3; fill: none; }
        .arrow-head { fill: #ff0000; }
        .guide { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #ff0000; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Header -->
    <rect class="header" width="540" height="60"/>
    <text class="button-text" x="20" y="40">← تعديل</text>
    
    <!-- First Name Field -->
    <text class="text-label" x="40" y="120">الاسم الأول</text>
    <rect class="input-field" x="40" y="140" width="460" height="50" rx="6"/>
    <text class="input-text" x="60" y="175">أم فاطمة</text>
    
    <!-- Last Name Field -->
    <text class="text-label" x="40" y="240">الاسم الأخير</text>
    <rect class="input-field" x="40" y="260" width="460" height="50" rx="6"/>
    <text class="input-text" x="60" y="295">محمد</text>
    
    <!-- About Field -->
    <text class="text-label" x="40" y="360">نبذة</text>
    <rect class="input-field" x="40" y="380" width="460" height="80" rx="6"/>
    <text class="input-text" x="60" y="410">طالبة علم وأم</text>
    <text class="input-text" x="60" y="435">معلمة قرآن</text>
    
    <!-- Arrow pointing to name field -->
    <line class="arrow" x1="380" y1="120" x2="420" y2="140"/>
    <polygon class="arrow-head" points="420,140 410,125 415,140"/>
    
    <!-- Guide text -->
    <text class="guide" x="20" y="100">اختاري الاسم</text>
    
    <!-- Save Button -->
    <rect class="button" x="120" y="550" width="300" height="50" rx="8"/>
    <text class="button-text" x="270" y="582" text-anchor="middle">💾 حفظ التعديلات</text>
  </svg>`,

  // Image 6: Delete Text
  deleteText: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .header { fill: #0088cc; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .input-field { fill: white; stroke: #0088cc; stroke-width: 2; }
        .selected-text { font-family: Arial, sans-serif; font-size: 16px; fill: white; background: #0088cc; }
        .keyboard { fill: #f0f0f0; stroke: #ddd; stroke-width: 1; }
        .key { font-family: Arial, sans-serif; font-size: 12px; fill: #333; }
        .highlight-box { fill: none; stroke: #ff0000; stroke-width: 3; }
        .guide { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #ff0000; }
        .arrow { stroke: #ff0000; stroke-width: 3; fill: none; }
        .arrow-head { fill: #ff0000; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Header -->
    <rect class="header" width="540" height="60"/>
    <text style="font-family: Arial; font-size: 16px; fill: white;" x="20" y="40">تعديل الاسم</text>
    
    <!-- Name Field with selected text -->
    <rect class="input-field" x="40" y="140" width="460" height="50" rx="6"/>
    <rect class="highlight-box" x="50" y="150" width="300" height="30"/>
    <text style="font-family: Arial; font-size: 16px; fill: white; background: #0088cc;" x="60" y="175">أم فاطمة محمد</text>
    <text style="font-family: Arial; font-size: 14px; fill: #999;" x="380" y="175">(محدد)</text>
    
    <!-- Cursor -->
    <line stroke="#0088cc" stroke-width="2" x1="365" y1="155" x2="365" y2="175"/>
    
    <!-- Delete button indicator -->
    <rect class="highlight-box" x="430" y="280" width="60" height="50"/>
    <text style="font-family: Arial; font-size: 14px; fill: #ff0000; text-anchor: center;" x="460" y="312">Delete</text>
    
    <!-- Guide text -->
    <text class="guide" x="20" y="250">اختاري النص</text>
    <text class="guide" x="20" y="280">ثم اضغطي Delete</text>
    
    <!-- Keyboard -->
    <g class="keyboard">
      <rect x="40" y="400" width="460" height="200" rx="8"/>
      <text style="font-family: Arial; font-size: 12px; fill: #999; text-anchor: center;" x="270" y="570">لوحة المفاتيح العربية</text>
    </g>
  </svg>`,

  // Image 7: Empty Name Field
  emptyField: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .header { fill: #0088cc; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .input-field { fill: white; stroke: #0088cc; stroke-width: 2; }
        .cursor { stroke: #0088cc; stroke-width: 2; animation: blink 1s infinite; }
        @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .placeholder { font-family: Arial, sans-serif; font-size: 14px; fill: #ccc; font-style: italic; }
        .keyboard { fill: #f0f0f0; stroke: #ddd; stroke-width: 1; }
        .guide { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #4CAF50; }
        .highlight-box { fill: none; stroke: #4CAF50; stroke-width: 3; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Header -->
    <rect class="header" width="540" height="60"/>
    <text style="font-family: Arial; font-size: 16px; fill: white;" x="20" y="40">تعديل الاسم</text>
    
    <!-- Empty Name Field -->
    <rect class="highlight-box" x="40" y="140" width="460" height="50" rx="6"/>
    <line class="cursor" x1="60" y1="155" x2="60" y2="175"/>
    <text class="placeholder" x="80" y="175">الاسم الجديد هنا</text>
    
    <!-- Guide text -->
    <text class="guide" x="20" y="240">الحقل فارغ الآن ✓</text>
    <text class="guide" x="20" y="270">اكتبي الاسم الجديد</text>
    
    <!-- Example text -->
    <text style="font-family: Arial; font-size: 14px; fill: #999;" x="40" y="330">أمثلة أسماء:</text>
    <text style="font-family: Arial; font-size: 14px; fill: #0088cc;" x="60" y="360">• أم محمد</text>
    <text style="font-family: Arial; font-size: 14px; fill: #0088cc;" x="60" y="390">• أم علي</text>
    <text style="font-family: Arial; font-size: 14px; fill: #0088cc;" x="60" y="420">• فاطمة</text>
    
    <!-- Keyboard -->
    <g class="keyboard">
      <rect x="40" y="500" width="460" height="200" rx="8"/>
      <text style="font-family: Arial; font-size: 12px; fill: #999; text-anchor: center;" x="270" y="670">لوحة المفاتيح العربية</text>
    </g>
  </svg>`,

  // Image 8: Save Button
  saveButton: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .header { fill: #0088cc; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .input-field { fill: #f5f5f5; stroke: #ddd; stroke-width: 2; }
        .input-text { font-family: Arial, sans-serif; font-size: 16px; fill: #333; }
        .button { fill: #4CAF50; stroke: none; }
        .button-highlight { fill: none; stroke: #ff0000; stroke-width: 4; }
        .button-text { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: white; }
        .arrow { stroke: #ff0000; stroke-width: 3; fill: none; }
        .arrow-head { fill: #ff0000; }
        .guide { font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; fill: #ff0000; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Header -->
    <rect class="header" width="540" height="60"/>
    <text class="button-text" x="20" y="40">← تعديل</text>
    
    <!-- First Name Field -->
    <text class="text-label" x="40" y="120">الاسم الأول</text>
    <rect class="input-field" x="40" y="140" width="460" height="50" rx="6"/>
    <text class="input-text" x="60" y="175">أم محمد</text>
    
    <!-- Last Name Field -->
    <text class="text-label" x="40" y="240">الاسم الأخير</text>
    <rect class="input-field" x="40" y="260" width="460" height="50" rx="6"/>
    <text class="input-text" x="60" y="295">علي</text>
    
    <!-- About Field -->
    <text class="text-label" x="40" y="360">نبذة</text>
    <rect class="input-field" x="40" y="380" width="460" height="80" rx="6"/>
    <text class="input-text" x="60" y="410">معلمة قرآن</text>
    
    <!-- Save Button with highlight -->
    <rect class="button-highlight" x="110" y="540" width="320" height="60" rx="8"/>
    <rect class="button" x="120" y="550" width="300" height="50" rx="8"/>
    <text class="button-text" x="270" y="582" text-anchor="middle">💾 حفظ التعديلات</text>
    
    <!-- Arrow pointing to button -->
    <line class="arrow" x1="380" y1="480" x2="420" y2="540"/>
    <polygon class="arrow-head" points="420,540 410,515 420,530"/>
    
    <!-- Guide text -->
    <text class="guide" x="20" y="440">اضغطي الزر الأخضر</text>
  </svg>`,

  // Image 9: Success Message
  successMessage: `<svg viewBox="0 0 540 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .bg { fill: white; }
        .success-banner { fill: #4CAF50; }
        .banner-text { font-family: Arial, sans-serif; font-size: 20px; font-weight: bold; fill: white; }
        .profile-pic { fill: #8ab4f8; }
        .text-label { font-family: Arial, sans-serif; font-size: 14px; fill: #999; }
        .text-value { font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; fill: #333; }
        .checkmark { fill: #4CAF50; }
        .guide { font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; fill: #4CAF50; }
      </style>
    </defs>
    
    <!-- Background -->
    <rect class="bg" width="540" height="1080"/>
    
    <!-- Success Banner -->
    <rect class="success-banner" width="540" height="100"/>
    <text class="banner-text" x="270" y="40" text-anchor="middle">✅ تم تحديث الملف!</text>
    <text class="banner-text" x="270" y="70" text-anchor="middle" style="font-size: 18px;">تم حفظ التعديلات بنجاح</text>
    
    <!-- Updated Profile Preview -->
    <!-- Profile Picture -->
    <circle class="profile-pic" cx="270" cy="200" r="60"/>
    <text style="font-size: 48px; text-anchor: middle;" x="270" y="210">👩</text>
    
    <!-- New Name Section -->
    <text class="text-label" x="40" y="300">الاسم الجديد</text>
    <text class="text-value" x="40" y="330">أم محمد علي</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="340" x2="500" y2="340"/>
    
    <!-- Username Section -->
    <text class="text-label" x="40" y="380">معرّف المستخدم</text>
    <text class="text-value" x="40" y="410">@umfatima2024</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="420" x2="500" y2="420"/>
    
    <!-- Updated About Section -->
    <text class="text-label" x="40" y="460">نبذة</text>
    <text class="text-value" x="40" y="490">معلمة قرآن</text>
    <line stroke="#eee" stroke-width="1" x1="40" y1="500" x2="500" y2="500"/>
    
    <!-- Checkmark animation area -->
    <circle fill="none" stroke="#4CAF50" stroke-width="3" cx="270" cy="600" r="50"/>
    <text style="font-size: 60px; text-anchor: middle;" x="270" y="615">✓</text>
    
    <!-- Success Messages -->
    <text class="guide" x="270" y="700" text-anchor="middle">تم الحفظ بنجاح! 🎉</text>
    <text style="font-family: Arial; font-size: 16px; fill: #666; text-anchor: center;" x="270" y="740">يمكنك إغلاق هذه الشاشة</text>
  </svg>`
};

export default svgs;

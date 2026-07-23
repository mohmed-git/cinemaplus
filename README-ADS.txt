حزمة تفعيل الإعلانات — CinemaPlus
===================================

الوضع قبل: مكوّنات الإعلانات كانت موجودة لكن غير مفعّلة إطلاقاً
(Ads.astro لم يكن مستدعى في Base.astro، وكان يحمل أكواد Adsterra قديمة).

ما تم:
  1) تحديث src/components/Ads.astro بالأكواد الجديدة (jabturfembitter.com):
     - Popunder / Anti-AdBlock JS  → يُحمَّل تلقائياً على كل صفحة
     - Smartlink كـ Popunder ثانوي على أول نقرة (مرة كل 24 ساعة، عبر localStorage)
  2) تفعيل <Ads /> داخل src/layouts/Base.astro قبل </body>
     → يظهر على كل صفحات الموقع تلقائياً بما فيها صفحات المشاهدة (/g و /gw).

الأكواد المستخدمة (خاصة بدومين cinemanaplus.site):
  Popunder:  https://jabturfembitter.com/ee/83/d3/ee83d32a4831963ddc166312735eb9d8.js
  Smartlink: https://jabturfembitter.com/wbnrckax?key=af6decf62eddc36667ffab047fdae426

الملفات في الحزمة (انسخها فوق مشروعك محافظاً على المسارات):
  src/components/Ads.astro
  src/layouts/Base.astro

ملاحظة: يوجد مكوّنان إضافيان لأنواع إعلانات أخرى (غير مفعّلين):
  - src/components/AdBanner.astro (بانرات 728x90 / 300x250 / 320x50)
  - src/components/AdNative.astro (Native Banner)
  ما زالا يحملان أكواد Adsterra قديمة. أخبرني إن أردت تفعيلهما أو تحديث أكوادهما.

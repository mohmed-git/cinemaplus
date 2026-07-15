# حل مشكلة البوسترات عبر Cloudflare R2

تم تجهيز كل شيء. هذا الدليل يشرح الملفات والخطوات.

## ما الذي تغيّر في الموقع؟

- كل عمل (فيلم/مسلسل/أنمي) كان **بدون بوستر حقيقي** (كان يستخدم صورة `placehold.co` المؤقتة) أصبح
  الآن يشير إلى صورة على الـ R2 الخاص بك:
  - الأفلام:   `https://pub-7bd753a4463049929e562aa677ad4251.r2.dev/movie/<slug>.jpg`
  - المسلسلات/الأنمي: `https://pub-7bd753a4463049929e562aa677ad4251.r2.dev/series/<slug>.jpg`
- عدد الأعمال التي عُولجت: **363** (159 فيلم + 204 مسلسل/أنمي).
- اسم الصورة هو **slug** العمل (نفس المعرّف المستخدم في روابط الموقع)، لذا الاسم في الموقع
  يطابق تماماً اسم الصورة التي سينزّلها السكربت.

> ملاحظة: الموقع كان أصلاً يشير إلى R2 لعدد 5812 عملاً آخر (تمت معالجتها سابقاً). لم نلمسها.
> هذه المهمة عالجت فقط الأعمال التي كانت ما زالت بصورة مؤقتة.

## الملفات المهمة

| الملف | الوصف |
|------|-------|
| `scripts/data/posters-to-download.csv` | قائمة الأعمال بدون بوستر: `name, type, image_name, page_url` |
| `scripts/download_posters.py` | سكربت بايثون يحمّل الصور الحقيقية ويرتّبها في مجلدي `movie/` و `series/` |
| `scripts/apply-r2-posters.mjs` | السكربت الذي وضع روابط R2 داخل بيانات الموقع (نُفّذ مسبقاً) |
| `scripts/build-poster-csv.mjs` | السكربت الذي ولّد ملف الـ CSV أعلاه (نُفّذ مسبقاً) |

## خطوات التشغيل

### 1) تثبيت المتطلبات
```bash
pip install requests beautifulsoup4
# اختياري لتحويل الصور إلى JPEG حقيقي:
pip install pillow
```

### 2) تحميل الصور
```bash
cd scripts
python download_posters.py
```
سينشئ مجلداً اسمه `posters/` بداخله:
```
posters/
  movie/    the-xxx.jpg ...   (159 صورة)
  series/   raakh.jpg ...      (204 صورة)
  download_report.csv          (تقرير نجاح/فشل لكل صورة)
```

خيارات مفيدة:
```bash
python download_posters.py --workers 8        # تحميل أسرع (متوازٍ)
python download_posters.py --convert          # تحويل البايتات إلى JPEG حقيقي (يتطلب Pillow)
python download_posters.py --retry-failed     # إعادة محاولة ما فشل فقط
python download_posters.py --out ./posters    # تغيير مجلد الإخراج
```

### 3) رفع الصور إلى R2
ارفع **محتوى** المجلدين إلى جذر الـ bucket بحيث تصبح المسارات هكذا:
```
movie/<slug>.jpg    ->  https://pub-7bd753a4463049929e562aa677ad4251.r2.dev/movie/<slug>.jpg
series/<slug>.jpg   ->  https://pub-7bd753a4463049929e562aa677ad4251.r2.dev/series/<slug>.jpg
```
يمكنك السحب والإفلات في لوحة Cloudflare R2، أو باستخدام wrangler:
```bash
# مثال (عدّل اسم الـ bucket):
npx wrangler r2 object put <BUCKET>/movie/raakh.jpg --file posters/movie/raakh.jpg
# أو ارفع المجلدات دفعة واحدة من لوحة التحكم
```

### 4) رفع ملفات الموقع
ملفات الموقع المعدّلة جاهزة (بدون مجلد `dist`). انشرها كالمعتاد على Cloudflare Pages
(أو `npm run build` ثم `npx wrangler pages deploy dist`). ستظهر البوسترات تلقائياً بمجرد
أن تصبح الصور موجودة على الـ R2.

## ملاحظات تقنية

- بعض الصور الأصلية بصيغة WebP لكنها محفوظة باسم `.jpg`. المتصفحات الحديثة و R2 تتعامل معها
  بشكل صحيح (يُكتشف النوع من المحتوى). إن أردت ضماناً كاملاً لكل المتصفحات استخدم `--convert`.
- إذا فشلت بعض الصور (موقع المصدر قد يحجب أحياناً) أعد التشغيل بـ `--retry-failed`.
- ملف `download_report.csv` يبيّن لك أي بوستر تم وأي بوستر يحتاج متابعة.

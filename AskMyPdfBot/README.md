# AskMyPdfBot — از جزوه‌ات بپرس 📄🤖

> نمونه اولیه (prototype) بات RAG برای تلگرام — نه محصول نهایی.
> قابلیت‌ها: آپلود PDF/TXT کوچک → استخراج متن → چانک → embedding → ذخیره در **Supabase pgvector** → پرسش‌وپاسخ با مدل OpenAI-compatible.

> [!WARNING]
> **پیش از اجرا:** در پنل Supabase دستور زیر را اجرا کنید تا افزونه pgvector فعال شود:
> ```sql
> create extension if not exists vector;
> ```
> سپس `sql/01_init.sql` را اجرا کنید.

---

## معماری (در یک نگاه)

```
کاربر PDF می‌فرستد
   → دانلود (سقف 15 مگ)
   → PyMuPDF استخراج متن
   → چانک ~۹۰۰ حرفی (overlap ۱۵۰)
   → embedding (سرویس OpenAI-compatible)
   → جدول chunks در pgvector
سوال کاربر
   → embedding سوال
   → RPC match_chunks (کدمسانی برداری)
   → پرامپت = فقط چانک‌های مرتبط
   → پاسخ فارسی با مدل
```

## فایل‌ها

| فایل | نقش |
|---|---|
| `main.py` | کل بات: هندلرها + صف پردازش + RAG |
| `requirements.txt` | وابستگی‌ها (pyTelegramBotAPI, httpx, PyMuPDF, python-dotenv) |
| `sql/01_init.sql` | جدول‌ها + تابع match_chunks (همه در یک فایل) |
| `sql/00_enable_pgvector.sql` | فعال‌سازی افزونه vector |
| `.env.example` | الگوی متغیرهای محیطی |

## متغیرهای محیطی

```env
BOT_TOKEN=...          # BotFather
SUPABASE_URL=...       # پروژه
SUPABASE_KEY=...       # service_role (فقط سمت سرور)
AI_BASE_URL=https://api.deepseek.com   # یا هر سرویس OpenAI-compatible
AI_API_KEY=sk-...
AI_CHAT_MODEL=deepseek-chat
AI_EMBED_MODEL=...     # مدل embedding همان سرویس؛ بعداً در بات با /embedmodel تنظیم می‌شود
ADMIN_TELEGRAM_IDS=65807806
```

## اجرا

```bash
pip install -r requirements.txt
cp .env.example .env    # مقادیر را پر کنید
python main.py
```

## جریان کاربر (دستورها)

| دستور | عملکرد |
|---|---|
| `/start` | راهنما |
| `/adddoc` | شروع آپلود (PDF/TXT تا ۱۵ مگ) |
| `/mydocs` | فهرست جزوه‌های من |
| `/deldoc <id>` | حذف جزوه + چانک‌ها |
| `/ask` | شروع پرسش (یا ریپلای روی پیام بات) |
| `/embedmodel <name>` | انتخاب مدل embedding (ادمین) |
| `/limits` | سقف‌های فعلی |

## محدودیت‌ها (محدودیت‌های پلتفرم)

- فایل ورودی ≤ **۱۵ مگ** (محدودیت Bot API) و فقط در چت خصوصی.
- هر کاربر حداکثر **۵ جزوه** فعال و **۳ آپلود در ۲۴ ساعت**.
- طول پاسخ AI محدود به **۹۰۰ توکن**.
- پردازش فایل در **thread جدا** تا UI بلاک نشود (حافظه بهینه نگه داشته شده).

## نقشه راه (برای تبدیل به محصول)

- [ ] صف پردازش با retry و پیشرفت درصدی
- [ ] OCR برای اسکن‌شده‌ها (احتمالاً خارج از Deployka؛ سرویس خارجی)
- [ ] پرداخت/اشتراک برای جزوه‌های بیشتر
- [ ] جستجوی ترکیبی (برداری + کلیدواژه با tsvector)

## مجوز

MIT — پیرو ریپوی مادر.

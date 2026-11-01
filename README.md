<div align="center">

<img src="assets/banner.jpg" alt="NewsStudio Banner" width="100%" style="border-radius: 12px; margin-bottom: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);" />

# 🗞️ NewsStudio 2026 (استودیو خبر)
### Modern Serverless AI Newsroom & Auto-Publishing Engine for Telegram Channels

[![Telegram Cloud](https://img.shields.io/badge/Telegram%20Cloud-Serverless-blue?logo=telegram&style=for-the-badge)](https://cloud.telegram.org)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-3.1%20Flash--Lite-orange?logo=googlegemini&style=for-the-badge)](https://ai.google.dev)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM%20SQLite-green?style=for-the-badge)](https://orm.drizzle.team)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%2022-brightgreen?logo=node.js&style=for-the-badge)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

<br/>

<p align="center">
  <a href="#-فارسی">🇮🇷 <b>فارسی</b></a> ·
  <a href="#-english">🇬🇧 <b>English</b></a> ·
  <a href="https://mohsen-niksirat.github.io/News-Channel-Bot/app.html">📱 <b>مینی‌اپ داشبورد تلگرام (Mini App)</b></a> ·
  <a href="https://mohsen-niksirat.github.io/News-Channel-Bot/">🌐 <b>مشاهده وب‌سایت و راهنما (Live Demo)</b></a>
</p>

</div>

---

<a id="-فارسی"></a>
## 🇮🇷 راهنمای فارسی

**NewsStudio 2026** یک استودیوی تمام‌عیار و ابری (سرورلس) برای مدیریت هوشمند کانال‌های خبری تلگرام است. این ربات با پایش مستمر فیدهای خبری معتبر، بازنویسی حرفه‌ای با به‌روزترین مدل‌های هوش مصنوعی (Google Gemini 3.1 Flash-Lite, Groq, DeepSeek, OpenAI) و روتر هوشمند استخر کلیدها، محتوای ژورنالی جذاب، تمیز و همراه با دکمه‌های شیشه‌ای تولید و به کانال شما ارسال می‌کند.

> 🌐 **وب‌سایت و آموزش گرافیکی آنلاین:** [https://mohsen-niksirat.github.io/News-Channel-Bot/](https://mohsen-niksirat.github.io/News-Channel-Bot/)

### 🌟 قابلیت‌های کلیدی

1. **⚡ معماری ۱۰۰٪ بدون سرور (Telegram Cloud Serverless):**
   - بدون نیاز به سرور مجازی (VPS) یا هزینه‌های نگهداری ماهانه.
   - اجرای ابری خودکار روی زیرساخت رسمی `tgcloud` با مقیاس‌پذیری آنی و پایداری ۲۴/۷.
2. **🧠 روتر چندپرووایدر هوش مصنوعی (مشابه 9Router):**
   - پشتیبانی از استخر نامحدود کلیدهای Gemini، Groq، DeepSeek، OpenAI، OpenRouter و **ارائه‌دهنده‌های سفارشی (Custom Providers)**.
   - ۴ استراتژی هوشمند مسیریابی: **فالبک اولویتی (Fallback)**، **راند رابین چرخشی (Round-Robin)**، **روتر هوشمند سلامت‌محور (Smart Router)** و **فیوژن (Fusion)**.
3. **🔐 ایزولاسیون کامل حریم خصوصی و اولویت کلیدها:**
   - هر کاربر فقط کلیدها و پروایدرهای اختصاصی خود را مدیریت و مصرف می‌کند.
   - قابلیت جابجایی ترتیب کلیدها با دکمه‌های ⬆️ و ⬇️ برای تغییر اولویت مصرف.
4. **🧪 تست زنده سلامت کلیدها و کشف مدل‌های فعال و رایگان:**
   - سنجش تاخیر پاسخگویی (Latency) و تست اتصال کلیدها تنها با یک کلیک (`/testkeys`).
   - استخراج خودکار و نمایش مدل‌های فعال و رایگان (مانند `gemini-3.1-flash-lite`، `gemma-4-26b-a4b-it`، `llama-3.3-70b-versatile`).
   - ارائه تمام نتایج به صورت یک پست جامع و کپی‌کردن نام مدل‌ها با یک ضربه.
5. **🗞️ بولتن تجمیعی هوشمند ضد اسپم (Anti-Spam Hourly Bulletin):**
   - پایش هوشمند دوره‌ای: اگر در یک بازه ۱ یا ۲ خبر جدید باشد، به صورت پست‌های مستقل و تحلیلی منتشر می‌شوند.
   - در صورت وجود **۳ خبر یا بیشتر**، همه در قالب یک **بولتن خبری ساعتی واحد** همراه با تیترهای جذاب، خلاصه روان و لینک اختصاصی هر منبع تجمیع می‌شوند تا کانال شلوغ نشود.
6. **📊 داشبورد تحلیل توکن‌ها و شفافیت هزینه‌ها (`/tokens`):**
   - گزارش دقیق مصرف توکن به تفکیک امروز، ۷ روز اخیر، ماهانه، کل دوره و بر حسب پروایدرها به همراه تخمین دلاری هزینه بر اساس تعرفه رسمی هر ۱ میلیون توکن.
7. **⏱️ زمان‌بندی ساعات انتشار و روزنامه صبحگاهی (`/schedule` و `/newspaper`):**
   - تعریف پنجره‌های زمانی انتشار در طول روز، دسته‌بندی موضوعی منابع و انتشار خودکار روزنامه گزیده اخبار ۲۴ ساعت گذشته.
8. **🔒 حریم خصوصی و حذف کامل حساب کاربری (`/delete`):**
   - امکان پاک‌سازی ۱۰۰٪ و بی‌بازگشت تمامی اطلاعات کاربر، کلیدها، منابع، پست‌ها و آمار توکن‌ها با تایید دومرحله‌ای.
9. **📨 خلاصه‌ساز پیام‌های پی‌وی و فورواردی:**
   - امکان فوروارد کردن هر پیام، متن یا خبر طولانی از چت‌ها یا کانال‌ها به ربات جهت تبدیل فوری به پست کانال.
10. **📑 صف بررسی پیش‌نویس‌ها و انتشار مستقیم:**
    - قابلیت فعال‌سازی انتشار خودکار (Auto-Publish) یا بررسی دستی با دکمه‌های ✅ انتشار، 🔁 بازنویسی و ❌ رد.
11. **🎨 ۶ پروفایل متنوع لحن نگارش هوش مصنوعی (`/tone`):**
    - پشتیبانی از سبک‌های رسمی، تحلیلی، صمیمی، طنز، دراماتیک و فوق‌خلاصه مینیمال با امکان تنظیم پرامپت دلخواه.
12. **📱 مینی‌اپ داشبورد زنده (Telegram Mini App):**
    - رابط شیشه‌ای مدرن جهت مدیریت لحظه‌ای پیش‌نویس‌ها، کلیدها، فیدها، تست سلامت و مصرف توکن‌ها.

---

### 🏛️ معماری سیستم

```mermaid
flowchart TD
    subgraph Sources["📡 منابع خبری"]
        RSS["🌐 RSS Feeds (Zoomit, TechCrunch, The Verge...)"]
        TG["📢 کانال‌های تلگرام"]
        PV["📨 پیام‌های فورواردی کاربران"]
    end

    subgraph Core["⚙️ هسته پردازشی Telegram Cloud"]
        Cron["⏰ اندپوینت کران‌ساعتی (/endpoints/cron)"]
        Scanner["🔍 اسکنر و هش‌یاب (Deduplication)"]
        Bulletin["🗞️ موتور تجمیع بولتن خبری"]
    end

    subgraph AIRouter["🧠 روتر هوشمند هوش مصنوعی"]
        KeyPool["🔑 استخر کلیدهای کاربران (ایزوله)"]
        Policies["🔀 استراتژی‌ها: Fallback | Round-Robin | Smart | Fusion"]
        Gemini["✨ Google Gemini 3.1 Flash-Lite"]
        Groq["⚡ Groq Llama 3.3"]
        Custom["🛠️ کاستوم پروایدرها (OpenAI-compatible)"]
    end

    subgraph Output["📢 خروجی و مقصد"]
        Channel["📢 کانال تلگرام کاربر"]
        Queue["📑 صف پیش‌نویس‌ها"]
        Stats["📊 داشبورد توکن‌ها"]
    end

    RSS --> Scanner
    TG --> Scanner
    PV --> Scanner
    Cron --> Scanner
    Scanner --> Bulletin
    Bulletin --> KeyPool
    KeyPool --> Policies
    Policies --> Gemini
    Policies --> Groq
    Policies --> Custom
    Gemini --> Output
    Groq --> Output
    Custom --> Output
```

---

### 🚀 راهنمای نصب و راه‌اندازی سریع

#### ۱. پیش‌نیازها
* [Node.js 20+](https://nodejs.org)
* یک ربات در تلگرام از طریق [@BotFather](https://t.me/BotFather)

#### ۲. دریافت و ساخت پروژه در تلگرام کلود
```bash
# ایجاد پروژه ابری رسمی
npm create @tgcloud/bot NewsStudio_Bot
cd NewsStudio_Bot

# دریافت وابستگی‌ها
npm install
```

#### ۳. تنظیم دیتابیس و مهاجرت اسکیما
```bash
npx tgcloud migrate --safe
```

#### ۴. استقرار روی تلگرام کلود (Deploy)
```bash
npx tgcloud push
```
پروژه شما بلافاصله روی سرورهای تلگرام قرار گرفته و آماده پاسخگویی می‌شود!

#### ۵. تنظیم کران‌جاب ساعتی رایگان
برای اینکه ربات هر یک ساعت به‌صورت خودکار منابع را پایش کرده و بولتن منتشر کند:
1. وارد سایت رایگان [cron-job.org](https://cron-job.org) شوید.
2. یک جاب جدید با دوره زمانی **هر ۱ ساعت** ایجاد کنید.
3. آدرس URL را برابر با اندپوینت زیر قرار دهید (جایگزین کردن `app_id` پروژه خودتان):
   ```text
   https://cloud.telegram.org/<YOUR_APP_ID>/endpoints/cron
   ```

---

<a id="-english"></a>
## 🇬🇧 English Documentation

**NewsStudio 2026** is a state-of-the-art serverless newsroom and automated content studio for Telegram channels. Powered by modern AI engines (**Google Gemini 3.1 Flash-Lite**, **Groq**, **DeepSeek**, and OpenAI-compatible custom endpoints), it continuously monitors RSS feeds and Telegram channels, extracts breaking updates, rewrites them into journalistic Persian posts, and delivers them directly to your channel with rich buttons.

### ✨ Key Features

- **⚡ 100% Serverless on Telegram Cloud:** No servers, no VPS, zero hosting costs, infinite scalability.
- **🧠 9Router Multi-Provider Architecture:** Manage unlimited keys across Gemini, Groq, DeepSeek, and custom base URLs.
- **🔀 4 Intelligent Routing Policies:**
  - *Priority Fallback:* Uses top-priority keys first and fails over automatically.
  - *Round-Robin:* Distributes workload evenly to maximize rate-limits.
  - *Smart Router:* Health-aware key selection minimizing latency and 429 errors.
  - *Advanced Fusion:* High-fidelity journalistic style.
- **🔐 Multi-Tenant Key Privacy & GDPR-grade Wipe (`/delete`):** Strict tenant isolation with priority up/down reordering (`⬆️`/`⬇️`) and a full two-step account deletion command removing all keys, sources, posts, and token records.
- **🧪 Key Health & Model Inspector (`/testkeys` & Nightly Ping):** Live latency test + automated nightly ping to detect dead or cooldown keys without alert spam.
- **🗞️ Anti-Spam Hourly Bulletin Aggregator:** Automatically bundles 3+ news items into a single editorial digest with clickable hyperlinks `<a href="...">` to preserve channel readability.
- **⏱️ Schedule Windows & Daily Newspaper (`/schedule` & `/newspaper`):** Publish posts within designated daily windows (Tehran Time) and receive a 24-hour morning newspaper digest.
- **🎨 6 Editorial Tone Profiles (`/tone`):** Standard formal, journalistic analysis, conversational, satirical critique, dramatic/breaking, and minimal summary with custom prompt overrides.
- **📱 Real-time Glassmorphic Mini App:** Manage drafts, sources, keys, live scans, health checks, and token costs directly from Telegram WebApp.
- **📊 Real-time Token Analytics & Cost Transparency (`/tokens`):** Track token consumption by day, week, month, key, and provider, with live USD cost calculations based on official rates per 1M tokens.
- **📨 On-Demand Forward Summarizer:** Forward any long article, tweet, or message to turn it into an engaging Telegram post.

---

### 📋 Bot Commands (`BOTCOMMANDS.txt`)

| Command | Description |
| :--- | :--- |
| `/start` | 🚀 Initialize bot and launch main menu |
| `/scan` | 🔍 Trigger an immediate news scan and AI analysis |
| `/review` | 📑 Open the draft review queue |
| `/newspaper` | 🗞️ Generate a custom newspaper edition |
| `/schedule` | ⏱️ Configure automated publishing time windows |
| `/tone` | 🎨 Configure AI journalistic tone and editorial style |
| `/sources` | 📡 Manage RSS feeds and Telegram sources |
| `/ai` | 🤖 AI key pool, routing policies & custom providers |
| `/testkeys` | 🧪 Live key health check & active model discovery |
| `/tokens` | 📊 Token usage and cost transparency dashboard |
| `/channel` | 📢 Channel setup and auto-publishing toggle |
| `/delete` | 🗑️ Full account wipe & data deletion |
| `/cancel` | ❌ Cancel current state and return to main menu |

---

### 📄 License

This project is open-source under the [MIT License](LICENSE).
Created with ❤️ by **[Mohsen Niksirat](https://github.com/mohsen-niksirat)**.

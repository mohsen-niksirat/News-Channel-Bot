# 📰 NewsChannelBot

<p align="center">
  <a href="#-فارسی">فارسی</a> ·
  <a href="#-english">English</a> ·
  <a href="#-espaol">Español</a> ·
  <a href="#-franais">Français</a> ·
  <a href="#-deutsch">Deutsch</a> ·
  <a href="#-русский">Русский</a> ·
  <a href="#-العربية">العربية</a> ·
  <a href="#-中文">中文</a>
</p>

A multi-user **Telegram bot** that turns RSS feeds into ready-to-publish **news channel posts**: it monitors international + Iranian feeds, uses AI to write a short post in your channel's language, and gives every user their own channel, auto/manual publishing mode, review queue, and post-deletion — all from the bot.

---

<a id="-فارسی"></a>
## 🇮🇷 فارسی

بِات چندکاربره مدیریت کانال خبری تلگرام. این بات فیدهای RSS داخلی و خارجی را پایش می‌کند، با هوش مصنوعی یک پست کوتاه فارسی می‌نویسد و به هر کاربر امکان می‌دهد کانال خودش را متصل کند، انتشار خودکار را روشن/خاموش کند، پیش‌نویس‌ها را قبل از انتشار بررسی کند و پست‌های منتشرشده را حذف کند.

### ✨ قابلیت‌ها
- پایش فیدهای RSS خبری بین‌المللی (BBC، Guardian، DW، Al Jazeera و…) و ایرانی (ایسنا، مهر، ایرنا، دیجیاتو و…)
- بازنویسی هوشمند با AI: اخبار انگلیسی → ترجمه به فارسی؛ اخبار فارسی → بازنویسی کوتاه
- چند ارائه‌دهنده AI با زنجیره fallback (Dahl، DeepSeek، XKIRO، Inception، Vyce) + چند کلید با چرخش round-robin
- انتشار **خودکار** یا **دستی** برای هر کاربر + صف بررسی با دکمه‌های ✅ انتشار / 🔁 تولید مجدد / ❌ رد
- منابع RSS + شبکه‌های اجتماعی، فیلتر کلمات کلیدی/دسته‌بندی، پست جمع‌بندی دوره‌ای (Digest)
- مدیریت کلیدهای AI از خود بات: `/keys`، `/addkey`، `/delkey`، `/balance`
- پست‌های تصویری (تا ۳ عکس از خود فید)، فوتر کانال، حذف پست از کانال
- اجرای دائمی در پس‌زمینه: اسکنر RSS + پاکسازی دوره‌ای داده‌های قدیمی

### 🚀 راه‌اندازی سریع

> 🎓 **آموزش گرافیکی گام‌به‌گام:** [آموزش پیاده‌سازی](https://mohsen-niksirat.github.io/News-Channel-Bot/) — با چک‌لیست تعاملی و شبیه‌ساز گفتگو

**پیش‌نیازها:** Python 3.10+، یک پروژه [Supabase](https://supabase.com) رایگان، یک AI Provider (فقط یکی کافی است)

**۱) ساخت بات در تلگرام:**
1. در تلگرام به [@BotFather](https://t.me/BotFather) پیام بدهید → `/newbot` → نام و یوزرنیم بات را انتخاب کنید
2. توکن را کپی کنید (`BOT_TOKEN`)
3. اختیاری: با `/setcommands` لیست دستورات فایل [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt) را ثبت کنید

**۲) دیتابیس:**
1. در [supabase.com](https://supabase.com) پروژه جدید بسازید
2. از **Project Settings → API** مقدارهای `SUPABASE_URL` و `SUPABASE_KEY` (کلید `service_role` — فقط سمت سرور!) را بردارید
3. در **SQL Editor** فایل‌های `sql/01_init.sql` تا `sql/10_custom_providers.sql` را به‌ترتیب اجرا کنید

**۳) هوش مصنوعی:** یک کلید از یکی از ارائه‌دهنده‌های سازگار با OpenAI بگیرید (مثلاً DeepSeek از [platform.deepseek.com](https://platform.deepseek.com)) و در `AI_KEYS` بگذارید.

**۴) اجرا:**
```bash
git clone https://github.com/mohsen-niksirat/News-Channel-Bot.git
cd News-Channel-Bot
pip install -r requirements.txt
cp .env.example .env        # و مقادیر را پر کنید — هرگز .env را کامیت نکنید!
python main.py
```

**۵) اتصال کانال:**
1. بات را به‌عنوان **ادمین** به کانال خود اضافه کنید (دسترسی «Delete messages» لازم است)
2. در چت بات: `/channel` → آیدی کانال مثل `@mychannel` را بفرستید
3. `/auto off` + `/scan` → بررسی دستی پیش‌نویس‌ها (برای شروع توصیه می‌شود)
4. وقتی از کیفیت راضی بودید: `/auto on`

### ⚙️ متغیرهای محیطی
حداقل ۴ متغیر لازم است؛ بقیه مقدار پیش‌فرض دارند — فایل [`.env.example`](.env.example) را ببینید.

| متغیر | توضیح |
|---|---|
| `BOT_TOKEN` | توکن بات از BotFather |
| `SUPABASE_URL` / `SUPABASE_KEY` | آدرس و کلید سرویس Supabase |
| `AI_KEYS` | کلیدهای AI به‌صورت فشرده: `dahl=sk-…;deepseek=sk-…` |
| `BOT_ACTIVE` | `false` = توقف کل اسکن/انتشار |
| `ADMIN_TELEGRAM_IDS` | آیدی تلگرام ادمین‌ها (دسترسی `/bot`, `/adminstats`) |

### 📡 مستقرسازی (Deploy)

| پلتفرم | توضیح |
|---|---|
| Deployka | [deployka.dev](https://deployka.dev) — پنل ساده، **نسخه رایگان ۱۲۸ مگ رم** (کافی برای این بات)؛ ریپو را وصل کنید + ۴ متغیر محیطی |
| VPS (اوبونتو + systemd) | سرویس systemd بسازید: `ExecStart=/usr/bin/python3 main.py` |
| Docker / Railway / Render / Fly.io | فرآیند دائمی با `python main.py` |

نکته: اسکنر یک ترد پس‌زمینه است — پروسه باید **همیشه روشن** بماند. راهنمای کامل: [docs/DEPLOY.md](docs/DEPLOY.md)

💡 **بدون کدنویسی:** مراحل فنی را می‌توانید به ایجنت‌های هوش مصنوعی (Freebuff، OpenCode، Xiaomi MiMo AI و…) بسپارید — فقط آدرس ریپو و ۴ مقدار کلیدی را به آن‌ها بدهید.

### 📋 دستورات بات
فهرست کامل: [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt) — موارد اصلی:

| دستور | عملکرد |
|---|---|
| `/start` `/help` | منو و راهنما |
| `/channel` | اتصال کانال |
| `/discussion` | اتصال گروه گفتگو (کامنت) |
| `/auto on\|off` | انتشار خودکار |
| `/scan` | اسکن فوری خبرها |
| `/review` | صف بررسی پیش‌نویس‌ها |
| `/published` | پست‌های منتشرشده + حذف 🗑 |
| `/sites` `/addsite` `/removesite` `/togglesite` | مدیریت منابع خبری |
| `/filter list\|add\|del\|on\|off` | فیلتر خبرها |
| `/ai` `/model` `/testai` `/aicheck` `/balance` | تنظیمات هوش مصنوعی |
| `/digest` | پست جمع‌بندی دوره‌ای |
| `/settings` | پنل تنظیمات |
| `/bot on\|off` | خاموش/روشن کل بات (ادمین) |

### 🗂 ساختار پروژه
```
NewsChannelBot/
├── main.py               # کل منطق بات: هندلرها + اسکنر + AI + انتشار/حذف
├── sources_defaults.py   # فیدهای پیش‌فرض هر کاربر جدید
├── requirements.txt
├── sql/                  # مهاجرت‌های دیتابیس Supabase (۱۰ فایل، به‌ترتیب اجرا شود)
├── docs/                 # برنامه توسعه، منابع خبری، نقشه تغییرات
├── .env.example          # الگوی متغیرهای محیطی (ایمن برای کامیت)
└── BOTCOMMANDS.txt       # لیست دستورات برای BotFather
```

### ⚖️ نکات حقوقی
هر پست همیشه **منبع + لینک** دارد؛ خلاصه‌سازی می‌شود نه بازنشر کامل مقاله. به شرایط استفاده هر سایت احترام بگذارید.

### 🔐 امنیت
- هرگز `.env` را کامیت نکنید (در `.gitignore` هست)
- کلید `service_role` Supabase فقط سمت سرور بماند
- اگر کلیدی لو رفت، فوراً از پنل ارائه‌دهنده revoke کنید و BotFather → `/revoke` را بزنید

---

<a id="-english"></a>
## 🇬🇧 English

A multi-user **Telegram channel-admin bot** for news. It monitors international and Iranian RSS feeds, uses an AI provider to write a short post in Persian (foreign news) or rewrite domestic ones, and gives every user their own channel binding, auto/manual publishing, a review queue, and post deletion — all via private chat with the bot.

### ✨ Features
- RSS monitoring: international (BBC, Guardian, DW, Al Jazeera…) + Iranian (ISNA, Mehr, IRNA, Digiato…)
- AI rewriting: EN → Persian translation, FA → short rewrite; multi-provider fallback chain (Dahl, DeepSeek, XKIRO, Inception, Vyce) with multiple keys per provider (round-robin + cooldown)
- Per-user **auto-publish** or **manual review** (✅ publish / 🔁 regenerate / ❌ reject)
- RSS + social sources, keyword/category filters, periodic digest posts
- Manage AI keys from the bot: `/keys`, `/addkey`, `/delkey`, `/balance`
- Image posts (up to 3 photos from the feed), channel footer, delete published posts
- Always-on background scanner + retention cleanup

### 🚀 Quick start

> 🎓 **Graphical step-by-step tutorial (Persian):** [Setup Guide](https://mohsen-niksirat.github.io/News-Channel-Bot/) — interactive checklist & chat simulator

**Prerequisites:** Python 3.10+, a free [Supabase](https://supabase.com) project, one AI provider key.

**1) Create the Telegram bot:**
1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → pick name & username
2. Copy the token → `BOT_TOKEN`
3. Optional: register the command list from [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt) via `/setcommands`

**2) Database:**
1. Create a project at [supabase.com](https://supabase.com)
2. From **Project Settings → API** copy `SUPABASE_URL` and `SUPABASE_KEY` (the `service_role` key — server-side only!)
3. Run `sql/01_init.sql` … `sql/10_custom_providers.sql` in order in the **SQL Editor**

**3) AI:** grab one key from any OpenAI-compatible provider (e.g. DeepSeek at [platform.deepseek.com](https://platform.deepseek.com)) and set it in `AI_KEYS`.

**4) Run:**
```bash
git clone https://github.com/mohsen-niksirat/News-Channel-Bot.git
cd News-Channel-Bot
pip install -r requirements.txt
cp .env.example .env        # then fill it in — NEVER commit .env!
python main.py
```

**5) Connect a channel:**
1. Add the bot as **admin** of your channel (needs *Delete messages* permission)
2. In the bot chat: `/channel` → send `@mychannel`
3. `/auto off` + `/scan` → review drafts manually (recommended at first)
4. Happy with quality? `/auto on`

### ⚙️ Environment variables
Only 4 are required; everything else has defaults — see [`.env.example`](.env.example).

| Variable | Meaning |
|---|---|
| `BOT_TOKEN` | Token from BotFather |
| `SUPABASE_URL` / `SUPABASE_KEY` | Supabase URL + service key |
| `AI_KEYS` | Compact AI keys: `dahl=sk-…;deepseek=sk-…` |
| `BOT_ACTIVE` | `false` pauses all scanning/publishing |
| `ADMIN_TELEGRAM_IDS` | Telegram ids allowed `/bot`, `/adminstats` |

### 📡 Deploy
Any always-on Python host: **Deployka** ([deployka.dev](https://deployka.dev) — simple panel, **free tier with 128 MB RAM**, enough for this bot; connect repo + 4 env vars), **VPS (systemd)**, Docker, Railway, Render, Fly.io. The scanner runs in a background thread, so the process must stay alive. Full guide: [docs/DEPLOY.md](docs/DEPLOY.md)

💡 **No-code option:** delegate the technical steps to AI coding agents (Freebuff, OpenCode, Xiaomi MiMo AI, …) — just give them the repo URL and the 4 key values.

### 📋 Commands
Full list: [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt) — highlights:

| Command | Action |
|---|---|
| `/start` `/help` | Menu & help |
| `/channel` | Bind channel |
| `/discussion` | Bind comment group |
| `/auto on\|off` | Toggle auto publish |
| `/scan` | Scan sources now |
| `/review` | Pending drafts |
| `/published` | Published posts + delete 🗑 |
| `/sites` `/addsite` `/removesite` `/togglesite` | Manage sources |
| `/filter list\|add\|del\|on\|off` | News filters |
| `/ai` `/model` `/testai` `/aicheck` `/balance` | AI settings |
| `/digest` | Periodic digest post |
| `/settings` | Settings panel |
| `/bot on\|off` | Master switch (admin) |

### 🗂 Project layout
```
NewsChannelBot/
├── main.py               # all bot logic: handlers + scanner + AI + publish/delete
├── sources_defaults.py   # default feeds for every new user
├── requirements.txt
├── sql/                  # Supabase migrations (10 files, run in order)
├── docs/                 # dev plan, source catalog, where-to-change map
├── .env.example          # env template (safe to commit)
└── BOTCOMMANDS.txt       # command list for BotFather
```

### ⚖️ Legal & 🔐 Security
Every post keeps **source + link**; articles are summarized, not republished. Respect each site's ToS. Never commit `.env`; keep the Supabase `service_role` key server-side only; revoke leaked keys immediately.

### 🤝 Contributing
Issues and PRs are welcome! Please keep the bot's user-facing strings in Persian, and run the bot once locally before opening a PR.

### 📄 License
MIT © 2026 Mohsen Niksirat — see [LICENSE](LICENSE).

---

<a id="-espaol"></a>
## 🇪🇸 Español

Bot de Telegram multiusuario para administrar canales de noticias. Supervisa feeds RSS internacionales e iraníes, usa un proveedor de IA para redactar un post breve en persa y permite a cada usuario vincular su canal, activar/desactivar la publicación automática, revisar borradores y eliminar posts publicados.

**Inicio rápido:**
1. Crea el bot con [@BotFather](https://t.me/BotFather) → copia el token en `BOT_TOKEN`
2. Crea un proyecto gratis en [Supabase](https://supabase.com) → copia `SUPABASE_URL` y `SUPABASE_KEY` (service_role) → ejecuta `sql/01_init.sql` … `sql/10_custom_providers.sql` en el **SQL Editor**
3. Consigue una clave de IA (p. ej. [DeepSeek](https://platform.deepseek.com)) y ponla en `AI_KEYS`
4. `pip install -r requirements.txt` · `cp .env.example .env` (rellenar) · `python main.py`
5. Añade el bot como **admin del canal** → `/channel` → `@micanal` → `/scan` → `/review`

Comandos principales: `/auto on|off`, `/published`, `/sites`, `/filter`, `/digest`, `/settings` — lista completa en [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt). Variables explicadas en [`.env.example`](.env.example). Licencia: MIT.

---

<a id="-franais"></a>
## 🇫🇷 Français

Bot Telegram multi-utilisateurs pour gérer des canaux d'actualités. Il surveille les flux RSS internationaux et iraniens, utilise une IA pour rédiger un court post en persan, et permet à chaque utilisateur de lier son canal, d'activer la publication automatique ou manuelle, de réviser les brouillons et de supprimer les posts publiés.

**Démarrage rapide :**
1. Créez le bot via [@BotFather](https://t.me/BotFather) → copiez le token dans `BOT_TOKEN`
2. Créez un projet gratuit sur [Supabase](https://supabase.com) → copiez `SUPABASE_URL` et `SUPABASE_KEY` (service_role) → exécutez `sql/01_init.sql` … `sql/10_custom_providers.sql` dans le **SQL Editor**
3. Obtenez une clé IA (ex. [DeepSeek](https://platform.deepseek.com)) et mettez-la dans `AI_KEYS`
4. `pip install -r requirements.txt` · `cp .env.example .env` (à remplir) · `python main.py`
5. Ajoutez le bot comme **admin du canal** → `/channel` → `@moncanal` → `/scan` → `/review`

Commandes principales : `/auto on|off`, `/published`, `/sites`, `/filter`, `/digest`, `/settings` — liste complète dans [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt). Variables documentées dans [`.env.example`](.env.example). Licence : MIT.

---

<a id="-deutsch"></a>
## 🇩🇪 Deutsch

Mehrbenutzer-Bot für Telegram-Nachrichtenkanäle. Er überwacht internationale und iranische RSS-Feeds, verfasst mit einer KI kurze Beiträge auf Persisch und ermöglicht jedem Nutzer die Kanal-Anbindung, automatische/manuelle Veröffentlichung, eine Freigabe-Warteschlange und das Löschen veröffentlichter Beiträge.

**Schnellstart:**
1. Bot über [@BotFather](https://t.me/BotFather) erstellen → Token in `BOT_TOKEN` eintragen
2. Kostenloses Projekt auf [Supabase](https://supabase.com) anlegen → `SUPABASE_URL` und `SUPABASE_KEY` (service_role) kopieren → `sql/01_init.sql` … `sql/10_custom_providers.sql` im **SQL Editor** ausführen
3. Einen KI-Key besorgen (z. B. [DeepSeek](https://platform.deepseek.com)) und in `AI_KEYS` eintragen
4. `pip install -r requirements.txt` · `cp .env.example .env` (ausfüllen) · `python main.py`
5. Bot als **Kanal-Admin** hinzufügen → `/channel` → `@meinkanal` → `/scan` → `/review`

Wichtigste Befehle: `/auto on|off`, `/published`, `/sites`, `/filter`, `/digest`, `/settings` — vollständige Liste in [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt). Variablen siehe [`.env.example`](.env.example). Lizenz: MIT.

---

<a id="-русский"></a>
## 🇷🇺 Русский

Многопользовательский Telegram-бот для управления новостными каналами. Он отслеживает международные и иранские RSS-ленты, с помощью ИИ пишет короткий пост на персидском языке и позволяет каждому пользователю привязать свой канал, включать авто- или ручную публикацию, проверять черновики и удалять опубликованные посты.

**Быстрый старт:**
1. Создайте бота через [@BotFather](https://t.me/BotFather) → вставьте токен в `BOT_TOKEN`
2. Создайте бесплатный проект на [Supabase](https://supabase.com) → скопируйте `SUPABASE_URL` и `SUPABASE_KEY` (service_role) → выполните `sql/01_init.sql` … `sql/10_custom_providers.sql` в **SQL Editor**
3. Получите ключ ИИ (напр. [DeepSeek](https://platform.deepseek.com)) и укажите его в `AI_KEYS`
4. `pip install -r requirements.txt` · `cp .env.example .env` (заполнить) · `python main.py`
5. Добавьте бота **администратором канала** → `/channel` → `@мойканал` → `/scan` → `/review`

Основные команды: `/auto on|off`, `/published`, `/sites`, `/filter`, `/digest`, `/settings` — полный список в [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt). Переменные описаны в [`.env.example`](.env.example). Лицензия: MIT.

---

<a id="-العربية"></a>
## 🇸🇦 العربية

بوت تيليجرام متعدد المستخدمين لإدارة قنوات الأخبار. يراقب تغذيات RSS الدولية والإيرانية، ويستخدم الذكاء الاصطناعي لكتابة منشور قصير باللغة الفارسية، ويتيح لكل مستخدم ربط قناته وتشغيل/إيقاف النشر التلقائي ومراجعة المسودات وحذف المنشورات.

**البداية السريعة:**
1. أنشئ البوت عبر [@BotFather](https://t.me/BotFather) → انسخ التوكن إلى `BOT_TOKEN`
2. أنشئ مشروعاً مجانياً على [Supabase](https://supabase.com) → انسخ `SUPABASE_URL` و`SUPABASE_KEY` (service_role) → نفّذ `sql/01_init.sql` … `sql/10_custom_providers.sql` في **SQL Editor**
3. احصل على مفتاح ذكاء اصطناعي (مثل [DeepSeek](https://platform.deepseek.com)) وضعه في `AI_KEYS`
4. `pip install -r requirements.txt` · `cp .env.example .env` (املأه) · `python main.py`
5. أضف البوت **مشرفاً للقناة** → `/channel` → `@قناتي` → `/scan` → `/review`

الأوامر الرئيسية: `/auto on|off`، `/published`، `/sites`، `/filter`، `/digest`، `/settings` — القائمة الكاملة في [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt). المتغيرات مشروحة في [`.env.example`](.env.example). الترخيص: MIT.

---

<a id="-中文"></a>
## 🇨🇳 中文

多用户 Telegram 新闻频道管理机器人。监控国际及伊朗 RSS 源，借助 AI 撰写简短的波斯语帖子，并让每位用户绑定自己的频道、切换自动/手动发布、审核草稿以及删除已发布的帖子。

**快速开始：**
1. 通过 [@BotFather](https://t.me/BotFather) 创建机器人 → 将 token 填入 `BOT_TOKEN`
2. 在 [Supabase](https://supabase.com) 创建免费项目 → 复制 `SUPABASE_URL` 与 `SUPABASE_KEY`（service_role）→ 在 **SQL Editor** 依次执行 `sql/01_init.sql` … `sql/10_custom_providers.sql`
3. 获取任一 AI 密钥（如 [DeepSeek](https://platform.deepseek.com)）并填入 `AI_KEYS`
4. `pip install -r requirements.txt` · `cp .env.example .env`（填写）· `python main.py`
5. 将机器人添加为**频道管理员** → `/channel` → `@我的频道` → `/scan` → `/review`

主要命令：`/auto on|off`、`/published`、`/sites`、`/filter`、`/digest`、`/settings` — 完整列表见 [`BOTCOMMANDS.txt`](BOTCOMMANDS.txt)。环境变量说明见 [`.env.example`](.env.example)。许可证：MIT。

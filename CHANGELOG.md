# Changelog — NewsStudio 2026

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-11-01

### 🚀 Highlights
Comprehensive upgrade bringing editorial tone profiles, topic categorization, daily scheduled publishing windows, a morning newspaper digest, a live glassmorphism Telegram Mini App dashboard, token pricing transparency, nightly automated key health checks, and full GDPR-grade account data wiping.

---

### 🎨 Phase 1 — AI Editorial Tone Profiles & Writing Styles
- **Added:** 6 built-in editorial tone presets in `tgcloud/lib/tones.js`:
  - `standard` (استاندارد خبری تحلیلی)
  - `formal` (رسمی و اداری)
  - `casual` (صمیمی و خودمانی)
  - `satirical` (طنز و کنایه‌آمیز)
  - `dramatic` (جنجالی و مهیج)
  - `minimal` (فوق‌خلاصه و مینیمال)
  - `custom` (پرامپت اختصاصی و دست‌نویس کاربر)
- **Added:** DB schema columns `toneProfile` and `toneCustom` on `users` table.
- **Added:** Interactive inline keyboard menu `/tone` with live prompt preview and custom text entry flow.
- **Added:** System prompt injection in `generateNewsRewrite` reflecting the user's chosen style.

---

### ⏱️ Phase 2 — Topic Categories & Scheduled Publishing Windows
- **Added:** Multi-category topic taxonomy in `tgcloud/lib/categories.js` covering 8 domains: `tech`, `economy`, `sport`, `world`, `social`, `culture`, `science`, `other`.
- **Added:** Per-source category filtering in `tgcloud/lib/scanner.js` so feeds only publish items matching allowed categories.
- **Added:** Scheduling engine in `tgcloud/lib/schedule.js` calculating publishing windows in `Asia/Tehran` timezone with ±10 minute tolerance.
- **Added:** Interactive `/schedule` command supporting format `HH:MM, HH:MM` and toggle between immediate and scheduled publishing.

---

### 🗞️ Phase 3 — Morning Newspaper Digest & Jina In-Memory Cache
- **Added:** Automated morning newspaper digest generator in `tgcloud/lib/digest.js` aggregating the top 8 important news items from the last 24 hours.
- **Added:** On-demand `/newspaper` command to generate an instant daily newspaper bulletin for private chat or channel.
- **Added:** Dedicated serverless cron endpoint `tgcloud/endpoints/digest_cron.js` and GitHub Actions workflow `.github/workflows/daily_digest.yml` running daily at 06:30 UTC.
- **Added:** High-performance LRU cache in `tgcloud/lib/cache.js` (max 50 entries, 10-minute TTL) wrapping Jina reader and public Telegram channel web scraping.

---

### 📱 Phase 4 — Live Mini App Dashboard & WebApp Control Panel
- **Added:** RESTful dashboard API in `tgcloud/endpoints/api.js` supporting endpoints:
  - `GET overview`: Live counts of drafts, today's posts, token consumption, and key health status.
  - `GET drafts`: Paginated list of pending news drafts.
  - `POST draft/action`: Instant approve & publish (`pub:`), reject (`rej:`), or edit draft.
  - `GET keys/sources`: Secure masked key metadata and active sources list.
- **Added:** Two-tier authentication gate supporting Telegram `initData` HMAC verification and HMAC-SHA256 signed bearer tokens.
- **Updated:** Glassmorphic UI in `app.html` (and compiled `dist/index.html`) with responsive RTL layout, Haptic feedback, and live action triggers.

---

### 💰 Phase 5 — Token Pricing Transparency, Nightly Key Health & Full Data Wipe
- **Added:** Token cost engine `tgcloud/lib/pricing.js` with static rate table per 1,000,000 tokens (prompt / completion) across Gemini, Groq, DeepSeek, OpenAI, OpenRouter, and custom endpoints.
- **Added:** Live USD cost estimation displayed in `/tokens` bot command and Mini App dashboard card.
- **Added:** Automated nightly key health checker `runNightlyKeyHealthCheck` in `tgcloud/lib/health_check.js` pinging keys with a 10-token prompt and transitioning status without alert spam.
- **Added:** Nightly cron workflow `.github/workflows/nightly_health.yml` running daily at 02:00 UTC.
- **Added:** GDPR-grade full account deletion command `/delete` with two-step inline confirmation wiping all user rows, sources, keys, custom providers, posts, and usage logs.

---

### 🛠️ Critical Bug Fixes & Refinements
- **Fixed:** Review queue rejected cards re-posting issue via Telegram `deleteMessage` before rendering replacement cards.
- **Fixed:** Jina IP reputation blocking (AS9009) via 3-tier fallback including Google Web Proxy (`harvester.js`).
- **Fixed:** Web preview media stripping on channel publishing via `link_preview_options: { prefer_large_media: true }` and markdown backslash unescaping.
- **Fixed:** Custom provider model resolution when fallback keys start with non-existent model tags.
- **Fixed:** Mini App loading overlay freeze via dead-code cleanup and 1.5s auto-dismiss safeguard.
- **Verified:** 40 unit test suites passing completely with 100% clean syntax checks across all modules.

---

### 📦 Honest Status of Items
- **Parked / Skipped:**
  - *Full client-side code splitting for Mini App:* Maintained as a single, self-contained `app.html` / `dist/index.html` file to adhere to Telegram Cloud serverless static hosting constraints (`static.source: dist`) without introducing heavy external webpack/vite build toolchains.
  - *Dynamic model fine-tuning:* Skipped as outside project scope; prompt-level tone engineering provides equivalent flexibility with zero infrastructure overhead.

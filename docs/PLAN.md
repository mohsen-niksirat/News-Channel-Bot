# NewsChannelBot — Multi-phase plan

**Product:** Multi-user Telegram admin bot that watches international + Iranian news RSS feeds, turns foreign items into Persian channel posts (DeepSeek), lets each user toggle **auto-publish** vs **manual review**, and can **delete** published posts from their channel.

**Stack:** Python (`telebot`) · Supabase (PostgREST) · DeepSeek (OpenAI-compatible) · Deployka (or any Python host) · `feedparser` for RSS.

---

## Phase 0 — Accounts & secrets (you, ~30–60 min)

| Step | Where |
|------|--------|
| Create bot | [@BotFather](https://t.me/BotFather) → `BOT_TOKEN` |
| New Supabase project | Dashboard → Project Settings → API → `SUPABASE_URL`, `SUPABASE_KEY` (service_role for bot) |
| DeepSeek key | platform.deepseek.com → `DEEPSEEK_API_KEY` |
| Run SQL | Supabase SQL Editor → `sql/01_init.sql` |
| Local env | `cp .env.example .env` and fill |
| Deploy | Deployka: deploy `main.py`, `sources_defaults.py`, `requirements.txt` + env vars |

**Exit criteria:** `python main.py` logs in; `/start` in Telegram creates a `bot_users` row.

---

## Phase 1 — Core bot (implemented in this repo)

- User registration + Persian UI
- **Channel bind** (`/channel`): @username or forward; checks bot is admin
- **Auto toggle** (`/auto on|off`) per user
- **RSS seed** per user from `sources_defaults.py` (international + Iranian)
- **Scan** `/scan` + background every `SCAN_INTERVAL_SEC`
- **DeepSeek** → Persian headline + short body + source link
- **Manual queue** `/review` + buttons: publish / regenerate / reject
- **Auto publish** when user auto=on
- **Delete** `/published` → 🗑 removes channel message via bot API

**Exit criteria:** Connect a test channel, run `/scan`, approve one post, see it live; delete it; flip `/auto on` and see a second post appear without buttons.

---

## Phase 2 — Source management (partially implemented)

- [x] List sources `/sources`
- [x] Add `/addsource name | url | category`
- [x] Enable/disable `/togglesource <id>`
- [ ] Category filter chips (world / tech / iran / sports) for what enters the queue
- [ ] Global admin seed sync when you edit `sources_defaults.py` (re-seed script)
- [ ] Health check: mark dead RSS URLs

---

## Phase 3 — Editorial quality

- Dedup / cluster (same story from BBC + Guardian → one post)
- “Breaking” vs “digest” mode
- Edit draft in chat before publish (reply-to-draft text)
- Image pull from RSS `enclosure` → send with post
- Daily digest post (evening summary of approved items)
- Tone presets (neutral news / tech brief)

---

## Phase 4 — Multi-channel & roles

- Multiple target channels per user + `/bind <channel>` list
- Separate auto flag per channel
- Sub-accounts / team editors
- Public `@bot` inline search over last articles

---

## Phase 5 — Scale & safety

- Quotas (Dahl-style) if you open the bot publicly
- RLS on Supabase if anything is exposed via anon key
- Longer article history → optional pgvector semantic search
- Web dashboard (optional) for review
- Monitoring + restart on Deployka

---

## Feature map (your requirements)

| Requirement | Command / behavior |
|-------------|-------------------|
| Watch foreign news sites | RSS international sources + DeepSeek FA |
| Watch domestic (Iranian) news | FA sources, short rewrite |
| Post to Telegram with source | Always `منبع` + `🔗` URL |
| Auto on/off | `/auto on\|off` + Settings button |
| Manual pick what to publish | Auto off → `/review` → ✅ |
| Delete uninteresting channel posts | `/published` → 🗑 (bot must have delete right) |

---

## News source pack

Full table: `docs/SOURCES.md`. Defaults also live in `sources_defaults.py`.

**International:** BBC World/Tech, Al Jazeera, Guardian, DW, France 24, Sky News, NPR, The Verge, TechCrunch, Ars Technica.

**Iranian / Persian:** ISNA (verified), Mehr, IRNA, Khabaronline, Tabnak, Digiato, Varzesh3.

Always keep **source + link** on posts; summarize, do not copy full articles.

---

## Security

- Never commit `.env`
- DeepSeek + Supabase keys only on the server
- Bot token only in BotFather + host env
- Prefer service_role key **only** on the bot host; do not ship it to clients

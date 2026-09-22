# WHERE TO CHANGE — NewsChannelBot

Read this after the code is on disk. **Only the places you are likely to edit.**

---

## 1) Secrets (must-do)

| What | File / place | Field |
|------|----------------|-------|
| Telegram bot token | `.env` or **Deployka env** | `BOT_TOKEN` |
| Supabase URL | same | `SUPABASE_URL` |
| Supabase service key | same | `SUPABASE_KEY` |
| DeepSeek API key | same | `DEEPSEEK_API_KEY` |
| Your Telegram id (admin stats) | same | `ADMIN_TELEGRAM_IDS=123,456` |

Create `.env` from `.env.example`. **Never commit `.env`.**

---

## 2) Database (must-do once)

| What | File | Where to run |
|------|------|----------------|
| Full schema | `sql/01_init.sql` | Supabase → **SQL Editor** → Run |

Tables created: `bot_users`, `sources`, `articles`, `drafts`.

---

## 3) News feeds (edit the list)

| What | File |
|------|------|
| Default RSS pack for every new user | **`main.py`** → `DEFAULT_SOURCES` (inlined for Deployka) |
| Human catalog + notes | `docs/SOURCES.md` |

Each entry:

```python
{"name": "BBC World", "url": "https://...", "lang": "en", "category": "world"},
```

- `lang`: `en` → DeepSeek **translates** to FA; `fa` → short rewrite only  
- `category`: free text used in UI (`world`, `tech`, `iran`, `sports`, …)  
- Remove any feed that 404s; users who already started keep their copy in Supabase (`sources` table) — they can `/togglesource` or you can delete rows in Supabase Table Editor.

---

## 4) AI behavior

| What | File | Where |
|------|------|--------|
| DeepSeek key | `.env` / Deployka | `DEEPSEEK_API_KEY` |
| **Dahl key** (OpenAI-compatible) | Deployka env | `DAHL_API_KEY`, `DAHL_BASE_URL=https://inference.dahl.global/v1`, `DAHL_MODEL` |
| Default AI provider | Deployka env | `AI_PROVIDER=dahl` or `deepseek` |
| Models catalog | `main.py` | `DAHL_MODEL_CATALOG` |
| Prompt (must be Persian) | `main.py` | `ai_persian_post()` → `system = "..."` |
| Post layout + footer | `main.py` | `format_post_fa()` |
| Per-user AI / footer | Telegram | `/ai`, `/model`, `/footer`, Settings buttons |
| Max feed images | `.env` | `MAX_POST_IMAGES=3` |
| Schema for images + AI cols | `sql/02_ai_images_footer.sql` | run in Supabase after 01 |

If DeepSeek key is empty, bot still runs with a **fallback** raw title+summary post.

---

## 5) Auto / manual defaults

| What | File | Where |
|------|------|--------|
| New users start with auto ON/OFF | `.env` | `DEFAULT_AUTO_PUBLISH=true\|false` |
| Per-user runtime toggle | Telegram | `/auto on\|off` or Settings button |
| Scan interval | `.env` | `SCAN_INTERVAL_SEC` (default 300) |
| Max new drafts per scan per user | `.env` | `MAX_ITEMS_PER_SCAN` |
| Max items read per RSS | `.env` | `MAX_FEED_ITEMS` |

## 5b) Digest (periodic round-up)

| What | File / command | Where |
|------|----------------|--------|
| Schema | `sql/04_digest.sql` | Supabase SQL Editor |
| Default on/off + hours + max items | `.env` | `DIGEST_ENABLED`, `DIGEST_INTERVAL_HOURS`, `DIGEST_MAX_ITEMS` |
| Per-user | Telegram | `/digest on\|off`, `/digest 6\|12\|24`, `/digest now` |
| Buttons | `main.py` | `digest_keyboard()`, `menu:digest` |
| Build + post logic | `main.py` | `build_digest_text()`, `publish_digest_for_user()`, `check_all_digests()` |
| Headline → channel post link | `main.py` | `channel_post_link()` |

Digest headlines are HTML links to the published channel post (tap title → open that news).

Code refs in `main.py`: `process_user_scan()`, `cmd_auto()`, `set:toggle_auto`.

---

## 6) Channel publish / delete

| What | File | Function |
|------|------|----------|
| Send post to channel | `main.py` | `publish_draft()` |
| Delete post from channel | `main.py` | `delete_from_channel()` |
| Channel bind / admin check | `main.py` | `on_channel_bind()` |

**Telegram side (not in code):**

1. BotFather → your bot  
2. Channel → Administrators → Add bot  
3. Permission: **Delete Post Messages** (required for 🗑)  
4. Bot chat → `/channel` → `@channelusername`

---

## 7) Message UI / language

| What | File | Where |
|------|------|--------|
| All bot texts (FA) | `main.py` | handlers `cmd_*`, `send_review_card`, `main_menu_keyboard` |
| Review buttons | `main.py` | `draft_keyboard()` |
| Version string | `.env` | `BOT_VERSION` |

---

## 8) Deployka (or any Python host)

| Setting | Value |
|---------|--------|
| Entry | `python main.py` |
| Files needed | `main.py`, `sources_defaults.py`, `requirements.txt` |
| Env | copy every key from `.env.example` |
| After code change | redeploy + restart |

---

## 9) Supabase table editor (manual data fixes)

| Task | Table |
|------|--------|
| See users / channels / auto flag | `bot_users` |
| Fix or disable a feed | `sources` |
| Inspect raw headlines | `articles` |
| Inspect drafts / published message ids | `drafts` |

Delete a bad post if bot delete failed: open Telegram channel as admin; or fix `drafts.published_message_id` and use `/published`.

---

## 10) Do NOT change unless you know why

- `.gitignore` (keep `.env` out of git)
- Unique constraints in `sql/01_init.sql` (`articles.guid`, `drafts (user_id, article_id)`)
- Supabase headers pattern in `sb_headers()` (API key + Bearer)

---

## Checklist — first run

1. [ ] BotFather token → `.env` `BOT_TOKEN`  
2. [ ] Supabase project → URL + service key → `.env`  
3. [ ] DeepSeek key → `.env`  
4. [ ] Run `sql/01_init.sql` in Supabase  
5. [ ] Adjust `sources_defaults.py` if you want fewer feeds  
6. [ ] `pip install -r requirements.txt` && `python main.py`  
7. [ ] Add bot to channel as admin (delete permission)  
8. [ ] Telegram: `/start` → `/channel` → `@yourchannel` → `/scan`  
9. [ ] `/auto off` for first week (recommended) → `/review` → publish manually  
10. [ ] When quality is good: `/auto on`  
11. [ ] Bad post: `/published` → 🗑 حذف از کانال  

---

## Code map (quick)

| Concern | Location in `main.py` |
|---------|------------------------|
| Env load | top of file |
| Supabase HTTP | `sb_get` / `sb_post` / `sb_patch` |
| User + seed sources | `upsert_user`, `seed_user_sources` |
| RSS parse | `parse_feed_items`, `ensure_article` |
| AI | `ai_persian_post` |
| Scan + auto/manual | `process_user_scan`, `scanner_loop` |
| Buttons | `on_callback`, `*_cb_*` |
| Delete published | `_cb_delete`, `delete_from_channel` |

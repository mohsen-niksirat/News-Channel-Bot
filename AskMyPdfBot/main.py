# ============================================================
# AskMyPdfBot — Telegram RAG prototype ("از جزوه‌ات بپرس")
# Stack: pyTelegramBotAPI + httpx (Supabase PostgREST) + pgvector
# Flow: upload PDF/TXT → extract → chunk → embed → store (pgvector)
#       question → embed → match_chunks RPC → AI answer (FA)
# Designed for Deployka free tier (128MB RAM) — lazy imports, small files.
# ============================================================

import json
import logging
import os
import re
import threading
import time
import html
from datetime import datetime, timezone, date

import httpx
import telebot
from dotenv import load_dotenv
from telebot.types import ForceReply, InlineKeyboardMarkup, InlineKeyboardButton

load_dotenv()

# ---------------- env ----------------
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
ADMIN_IDS = {int(x) for x in re.split(r"[,\s]+", os.getenv("ADMIN_TELEGRAM_IDS", "") or "") if x.strip().isdigit()}

AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.deepseek.com").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_CHAT_MODEL = os.getenv("AI_CHAT_MODEL", "deepseek-chat")
AI_EMBED_MODEL = os.getenv("AI_EMBED_MODEL", "").strip()
try:
    AI_EMBED_DIM = int(os.getenv("AI_EMBED_DIM", "1536"))
except ValueError:
    AI_EMBED_DIM = 1536

MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "15"))
MAX_DOCS_PER_USER = int(os.getenv("MAX_DOCS_PER_USER", "5"))
MAX_UPLOADS_PER_DAY = int(os.getenv("MAX_UPLOADS_PER_DAY", "3"))
MAX_QUESTIONS_PER_DAY = int(os.getenv("MAX_QUESTIONS_PER_DAY", "40"))
MAX_ANSWER_TOKENS = int(os.getenv("MAX_ANSWER_TOKENS", "900"))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "6"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("askmypdf")

if not BOT_TOKEN or not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("Missing BOT_TOKEN / SUPABASE_URL / SUPABASE_KEY — fill .env first")

bot = telebot.TeleBot(BOT_TOKEN, threaded=True)

# user_tg_id -> {"doc_ids": [...], "ts": float}   (in-flight uploads)
pending = {}
# user_tg_id -> question mode (ask on next plain message)
ask_mode = set()

# ============================================================
# Supabase helpers (PostgREST via httpx)
# ============================================================

def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def sb_get(table, params=None):
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/{table}", params=params or {},
                  headers=sb_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def sb_post(table, payload):
    r = httpx.post(f"{SUPABASE_URL}/rest/v1/{table}", json=payload,
                   headers=sb_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def sb_patch(table, match, payload):
    r = httpx.patch(f"{SUPABASE_URL}/rest/v1/{table}", params=match, json=payload,
                    headers=sb_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def sb_delete(table, match):
    r = httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", params=match,
                     headers=sb_headers(), timeout=60)
    r.raise_for_status()
    return r


def sb_rpc(fn, payload):
    r = httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", json=payload,
                   headers=sb_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def today():
    return date.today().isoformat()


def upsert_user(m):
    sb_post("bot_users", {"tg_id": m.from_user.id,
                          "first_name": (m.from_user.first_name or "")[:64]})
    # postgrest upsert needs Prefer: resolution=merge-duplicates; simpler: ignore error
    # (bot_users has PK tg_id; a duplicate insert will 409 — treat as success)


def quota_get(user, field):
    try:
        rows = sb_get("daily_usage", {"user_tg_id": f"eq.{user}",
                                      "day": f"eq.{today()}"})
        return (rows[0].get(field) or 0) if rows else 0
    except Exception:
        return 0


def quota_inc(user, field, by=1):
    try:
        rows = sb_get("daily_usage", {"user_tg_id": f"eq.{user}",
                                      "day": f"eq.{today()}"})
        if rows:
            sb_patch("daily_usage",
                     {"user_tg_id": f"eq.{user}", "day": f"eq.{today()}"},
                     {field: (rows[0].get(field) or 0) + by})
        else:
            sb_post("daily_usage", {"user_tg_id": user, field: by})
    except Exception as e:
        log.warning("quota_inc failed: %s", e)


def bump_heartbeat():
    try:
        sb_patch("heartbeat", {"id": "eq.1"}, {"ts": datetime.now(timezone.utc).isoformat()})
    except Exception as e:
        log.warning("heartbeat failed: %s", e)


# ============================================================
# AI helpers (OpenAI-compatible)
# ============================================================

def ai_chat(system, user_text, max_tokens=MAX_ANSWER_TOKENS):
    r = httpx.post(f"{AI_BASE_URL}/chat/completions",
                   headers={"Authorization": f"Bearer {AI_API_KEY}"},
                   json={
                       "model": AI_CHAT_MODEL,
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": user_text}],
                       "max_tokens": max_tokens,
                       "temperature": 0.3,
                   }, timeout=120)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def ai_embed(texts):
    """texts: list[str] -> list[list[float]]"""
    if not AI_EMBED_MODEL:
        raise RuntimeError("AI_EMBED_MODEL is empty — set it in .env or via /embedmodel")
    r = httpx.post(f"{AI_BASE_URL}/embeddings",
                   headers={"Authorization": f"Bearer {AI_API_KEY}"},
                   json={"model": AI_EMBED_MODEL, "input": texts}, timeout=120)
    r.raise_for_status()
    data = r.json()["data"]
    # keep API order
    return [d["embedding"] for d in sorted(data, key=lambda x: x["index"])]


# ============================================================
# Text extraction / chunking (lazy imports to keep RAM low)
# ============================================================

MAX_BYTES = MAX_FILE_MB * 1024 * 1024
CHUNK_CHARS = 900
CHUNK_OVERLAP = 150


def extract_text_pdf(path):
    import fitz  # PyMuPDF (lazy)
    out = []
    with fitz.open(path) as doc:
        for page in doc:
            t = page.get_text("text") or ""
            if t.strip():
                out.append(t)
    return "\n".join(out)


def extract_text_txt(path):
    for enc in ("utf-8", "utf-16", "cp1256"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ValueError("could not decode text file")


def clean_text(t):
    t = re.sub(r"\r", "", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def chunk_text(t):
    if len(t) <= CHUNK_CHARS:
        return [t] if t else []
    chunks, i = [], 0
    step = CHUNK_CHARS - CHUNK_OVERLAP
    while i < len(t):
        piece = t[i:i + CHUNK_CHARS]
        # prefer breaking at whitespace
        if i + CHUNK_CHARS < len(t):
            cut = piece.rfind("\n")
            if cut < CHUNK_CHARS // 2:
                cut = piece.rfind(" ")
            if cut > 0:
                piece = piece[:cut]
        chunks.append(piece.strip())
        i += max(1, len(piece) - CHUNK_OVERLAP)
    return [c for c in chunks if c]


# ============================================================
# Ingest pipeline (runs in a worker thread)
# ============================================================

def process_upload(user, doc_id, path, kind):
    try:
        text = extract_text_pdf(path) if kind == "pdf" else extract_text_txt(path)
        text = clean_text(text)
        if len(text) < 200:
            raise ValueError("متن استخراج‌شده خیلی کوتاه است (شاید اسکن شده باشد)")
        chunks = chunk_text(text)
        if len(chunks) > 400:
            raise ValueError("سند خیلی بزرگ است — نسخه‌ی کوتاه‌تر بفرستید")

        n_pages = len(chunks)  # informational
        # embed in batches of 16
        vecs = []
        for i in range(0, len(chunks), 16):
            vecs.extend(ai_embed(chunks[i:i + 16]))

        rows = [{"doc_id": doc_id, "user_tg_id": user, "chunk_no": i,
                 "content": c[:4000], "embedding": v}
                for i, (c, v) in enumerate(zip(chunks, vecs))]
        for i in range(0, len(rows), 50):
            sb_post("chunks", rows[i:i + 50])

        sb_patch("docs", {"id": f"eq.{doc_id}"},
                 {"status": "ready", "n_chunks": len(chunks), "n_pages": n_pages})
        bot.send_message(user, f"✅ جزوه آماده شد — {len(chunks)} بخش.\nحالا بپرس: /ask")
    except Exception as e:
        log.exception("ingest failed")
        try:
            sb_patch("docs", {"id": f"eq.{doc_id}"},
                     {"status": "failed", "error": str(e)[:300]})
        except Exception:
            pass
        bot.send_message(user, f"❌ پردازش فایل ناموفق بود:\n{html.escape(str(e)[:300])}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def is_admin(m):
    return m.from_user.id in ADMIN_IDS


# ============================================================
# Bot handlers
# ============================================================

@bot.message_handler(commands=["start", "help"])
def cmd_start(m):
    upsert_user(m)
    bot.reply_to(m, (
        "📄🤖 *از جزوه‌ات بپرس*\n\n"
        "۱) /adddoc — آپلود PDF یا TXT (تا ۱۵ مگ)\n"
        "۲) /mydocs — فهرست جزوه‌ها\n"
        "۳) /ask — پرسش از جزوه‌ها\n"
        "۴) /limits — سقف‌ها\n\n"
        "پرسش‌ها فقط از *محتوای جزوه‌های خودت* پاسخ داده می‌شود."
    ), parse_mode="Markdown")


@bot.message_handler(commands=["limits"])
def cmd_limits(m):
    bot.reply_to(m, (
        f"سقف‌ها:\n"
        f"• حجم فایل: {MAX_FILE_MB} مگ\n"
        f"• جزوه‌های فعال: {MAX_DOCS_PER_USER}\n"
        f"• آپلود در ۲۴ ساعت: {MAX_UPLOADS_PER_DAY}\n"
        f"• پرسش در ۲۴ ساعت: {MAX_QUESTIONS_PER_DAY}"
    ))


@bot.message_handler(commands=["embedmodel"])
def cmd_embedmodel(m):
    global AI_EMBED_MODEL
    if not is_admin(m):
        return bot.reply_to(m, "ادمین نیستید.")
    txt = (m.text or "").split(maxsplit=1)
    if len(txt) != 2:
        cur = AI_EMBED_MODEL or "(empty)"
        return bot.reply_to(m, f"الان: {cur}\nاستفاده: /embedmodel <name>\n"
                               f"بعد از تغییر، جدول chunks باید vector({AI_EMBED_DIM}) باشد.")
    AI_EMBED_MODEL = txt[1].strip()
    bot.reply_to(m, f"مدل embedding شد: {AI_EMBED_MODEL}")


@bot.message_handler(commands=["mydocs"])
def cmd_mydocs(m):
    upsert_user(m)
    try:
        rows = sb_get("docs", {"user_tg_id": f"eq.{m.from_user.id}",
                               "order": "id.desc", "limit": "20"})
    except Exception as e:
        return bot.reply_to(m, f"خطا: {e}")
    if not rows:
        return bot.reply_to(m, "هنوز جزوه‌ای نداری — /adddoc")
    lines = []
    for r in rows:
        icon = {"ready": "✅", "processing": "⏳", "failed": "❌"}.get(r.get("status"), "•")
        lines.append(f"{icon} #{r['id']} — {r['name']} ({r.get('n_chunks') or 0} بخش)")
    lines.append("\nحذف: /deldoc <id>")
    bot.reply_to(m, "\n".join(lines))


@bot.message_handler(commands=["deldoc"])
def cmd_deldoc(m):
    parts = (m.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        return bot.reply_to(m, "استفاده: /deldoc <id>")
    doc_id = int(parts[1])
    try:
        rows = sb_get("docs", {"id": f"eq.{doc_id}", "user_tg_id": f"eq.{m.from_user.id}"})
        if not rows:
            return bot.reply_to(m, "چنین جزوه‌ای نداری.")
        sb_delete("docs", {"id": f"eq.{doc_id}"})   # chunks cascade in DB
        bot.reply_to(m, f"🗑 جزوه #{doc_id} و همه‌ی بخش‌هایش حذف شد.")
    except Exception as e:
        bot.reply_to(m, f"خطا: {e}")


@bot.message_handler(commands=["cancel"])
def cmd_cancel(m):
    pending.pop(m.from_user.id, None)
    ask_mode.discard(m.from_user.id)
    bot.reply_to(m, "لغو شد.")


# --- upload flow ---
@bot.message_handler(commands=["adddoc"])
def cmd_adddoc(m):
    upsert_user(m)
    uid = m.from_user.id
    try:
        docs = sb_get("docs", {"user_tg_id": f"eq.{uid}", "status": "neq.failed"})
        if len(docs) >= MAX_DOCS_PER_USER:
            return bot.reply_to(m, f"حداکثر {MAX_DOCS_PER_USER} جزوه فعال — اول با /deldoc جای آزاد کن.")
        if quota_get(uid, "uploads") >= MAX_UPLOADS_PER_DAY:
            return bot.reply_to(m, "سقف آپلود امروز پر شد — فردا دوباره.")
    except Exception as e:
        return bot.reply_to(m, f"خطا: {e}")
    pending[uid] = {"ts": time.time()}
    bot.reply_to(m, "فایل PDF یا TXT را بفرست (تا ۱۵ مگ). لغو: /cancel")


@bot.message_handler(content_types=["document"])
def on_document(m):
    uid = m.from_user.id
    if uid not in pending:
        return bot.reply_to(m, "اول /adddoc را بزن، بعد فایل را بفرست.")
    doc = m.document
    name = doc.file_name or "file"
    kind = name.lower().endswith(".pdf") and "pdf" or (
           name.lower().endswith(".txt") and "txt" or None)
    if not kind:
        return bot.reply_to(m, "فقط PDF یا TXT.")
    if (doc.file_size or 0) > MAX_BYTES:
        return bot.reply_to(m, f"فایل بزرگ‌تر از {MAX_FILE_MB} مگ است.")

    pending.pop(uid, None)
    try:
        row = sb_post("docs", {"user_tg_id": uid, "name": name[:120],
                               "status": "processing"})[0]
        doc_id = row["id"]
    except Exception as e:
        return bot.reply_to(m, f"خطا: {e}")
    quota_inc(uid, "uploads")

    fi = bot.get_file(doc.file_id)
    path = f"/tmp/ncb_{uid}_{doc_id}.{kind}"
    downloaded = bot.download_file(fi.file_path)
    with open(path, "wb") as f:
        f.write(downloaded)

    bot.reply_to(m, "⏳ در حال پردازش… (استخراج → چانک → embedding)")
    threading.Thread(target=process_upload, args=(uid, doc_id, path, kind),
                     daemon=True).start()


# --- Q&A flow ---
@bot.message_handler(commands=["ask"])
def cmd_ask(m):
    upsert_user(m)
    uid = m.from_user.id
    if quota_get(uid, "questions") >= MAX_QUESTIONS_PER_DAY:
        return bot.reply_to(m, "سقف پرسش امروز پر شد — فردا دوباره.")
    if not AI_EMBED_MODEL:
        return bot.reply_to(m, "مدل embedding تنظیم نشده — ادمین با /embedmodel ستش کند.")
    ask_mode.add(uid)
    bot.reply_to(m, "سوالت را بنویس:", reply_markup=ForceReply())


@bot.message_handler(func=lambda m: True, content_types=["text"])
def on_text(m):
    uid = m.from_user.id
    if uid in ask_mode or (m.reply_to_message and "بپرس" in (m.reply_to_message.text or "")):
        ask_mode.discard(uid)
        _answer(m)
    elif m.text and not m.text.startswith("/"):
        bot.reply_to(m, "برای پرسش /ask را بزن.")


def _answer(m):
    uid = m.from_user.id
    q = (m.text or "").strip()
    if not q:
        return
    quota_inc(uid, "questions")
    bump_heartbeat()
    try:
        qvec = ai_embed([q])[0]
        hits = sb_rpc("match_chunks", {"p_user": uid,
                                       "p_embedding": qvec,
                                       "p_k": RAG_TOP_K})
    except Exception as e:
        return bot.reply_to(m, f"خطا: {e}")
    if not hits:
        return bot.reply_to(m, "چیزی مرتبط پیدا نشد — شاید جزوه‌ای نداری (/mydocs).")

    ctx = "\n\n---\n\n".join(
        f"[{h['doc_name']} · بخش {h['chunk_no']}]\n{h['content'][:1200]}" for h in hits)
    system = (
        "تو دستیار مطالعاتی فارسی‌زبان هستی. فقط بر اساس «زمینه» پاسخ بده؛ "
        "اگر جواب در زمینه نبود صادقانه بگو پیدا نکردی. پاسخ کوتاه و ساختاریافته بده."
    )
    user_prompt = f"زمینه:\n{ctx}\n\nسوال: {q}\n\nپاسخ فارسی:"
    try:
        ans = ai_chat(system, user_prompt)
    except Exception as e:
        return bot.reply_to(m, f"خطای AI: {e}")

    src = "، ".join(sorted({h["doc_name"] for h in hits})[:3])
    bot.reply_to(m, f"{ans}\n\n📚 منابع: {src}")


# ============================================================
# Background loops
# ============================================================

def loops():
    while True:
        bump_heartbeat()          # keeps free-tier Supabase project active
        time.sleep(6 * 3600)


if __name__ == "__main__":
    log.info("AskMyPdfBot starting…")
    threading.Thread(target=loops, daemon=True).start()
    bot.infinity_polling(timeout=60, long_polling_timeout=60)

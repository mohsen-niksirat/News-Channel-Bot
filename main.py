# ============================================================
# NewsChannelBot — multi-user Telegram news admin bot
# - Monitors international + Iranian RSS feeds
# - DeepSeek → Persian title + short summary
# - Per-user AUTO publish toggle or manual review queue
# - Delete published posts from the user's channel
# Stack: pyTelegramBotAPI + httpx (Supabase PostgREST) + DeepSeek
# ============================================================

import hashlib
import html
import json
import logging
import os
import random
import re
import threading
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

import feedparser
import httpx
import telebot
from dotenv import load_dotenv
from telebot.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ForceReply,
    InputMediaPhoto,
)

# Default RSS sources (inlined so Deployka only needs main.py + requirements.txt).
# Edit this list to change what every new user starts with.
# lang en → DeepSeek translates to Persian; lang fa → short rewrite only.
DEFAULT_SOURCES = [
    {"name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml", "lang": "en", "category": "world"},
    {"name": "BBC Technology", "url": "https://feeds.bbci.co.uk/news/technology/rss.xml", "lang": "en", "category": "tech"},
    {"name": "Al Jazeera English", "url": "https://www.aljazeera.com/xml/rss/all.xml", "lang": "en", "category": "world"},
    {"name": "Guardian World", "url": "https://www.theguardian.com/world/rss", "lang": "en", "category": "world"},
    {"name": "Guardian Tech", "url": "https://www.theguardian.com/technology/rss", "lang": "en", "category": "tech"},
    {"name": "DW English", "url": "https://rss.dw.com/rdf/rss-en-all", "lang": "en", "category": "world"},
    {"name": "France 24 English", "url": "https://www.france24.com/en/rss", "lang": "en", "category": "world"},
    {"name": "Sky News", "url": "https://feeds.skynews.com/feeds/rss/home.xml", "lang": "en", "category": "world"},
    {"name": "NPR World", "url": "https://feeds.npr.org/1004/rss.xml", "lang": "en", "category": "world"},
    {"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml", "lang": "en", "category": "tech"},
    {"name": "TechCrunch", "url": "https://techcrunch.com/feed/", "lang": "en", "category": "tech"},
    {"name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/index", "lang": "en", "category": "tech"},
    {"name": "TechRadar", "url": "https://www.techradar.com/rss", "lang": "en", "category": "tech"},
    {"name": "ISNA", "url": "https://www.isna.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Mehr News", "url": "https://www.mehrnews.com/rss", "lang": "fa", "category": "iran"},
    {"name": "IRNA", "url": "https://www.irna.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Khabaronline", "url": "https://www.khabaronline.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Tabnak", "url": "https://www.tabnak.ir/fa/rss/allnews", "lang": "fa", "category": "iran"},
    {"name": "Hamshahri", "url": "https://www.hamshahrionline.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "BBC Farsi", "url": "https://feeds.bbci.co.uk/persian/rss.xml", "lang": "fa", "category": "iran"},
    {"name": "Digiato", "url": "https://digiato.com/feed/", "lang": "fa", "category": "tech"},
    {"name": "Varzesh3", "url": "https://www.varzesh3.com/rss/all", "lang": "fa", "category": "sports"},
]

load_dotenv()

# Kill switch: set BOT_ACTIVE=false to pause scanning and publishing
# (bot still responds to commands like /start, /settings, /bot on)
BOT_ACTIVE = os.getenv("BOT_ACTIVE", "true").lower() in ("1", "true", "yes")


def _parse_ai_keys() -> dict[str, str]:
    """
    Compact single-env form (Deployka caps env var count):
      AI_KEYS=xkiro=sk-…;inception=…;vyce=…;dahl=…;deepseek=…
    Also accepts newline or comma separated. Individual *_API_KEY vars still win.
    """
    raw = (os.getenv("AI_KEYS", "") or "").strip()
    out: dict[str, str] = {}
    if not raw:
        return out
    for part in re.split(r"[;\n,]+", raw):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, val = part.partition("=")
        name = name.strip().lower().removesuffix("_api_key").strip()
        val = val.strip().strip('"').strip("'")
        if name and val:
            out[name] = val
    return out


_COMPACT = _parse_ai_keys()


def _pkeys(name: str, env: str) -> list:
    """Multiple keys per provider: separated by | or whitespace or + in one env value."""
    raw = (os.getenv(env, "").strip() or _COMPACT.get(name, "")).strip()
    if not raw:
        return []
    parts = re.split(r"[|\s,+]+", raw)
    seen, out = set(), []
    for p in parts:
        p = p.strip().strip('"').strip("'")
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _pkey(name: str, env: str) -> str:
    ks = _pkeys(name, env)
    return ks[0] if ks else ""


BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
DEEPSEEK_API_KEY = _pkey("deepseek", "DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# Optional OpenAI-compatible provider: https://inference.dahl.global/
DAHL_API_KEY = _pkey("dahl", "DAHL_API_KEY")
DAHL_BASE_URL = os.getenv("DAHL_BASE_URL", "https://inference.dahl.global/v1").rstrip("/")
# Server default model for Dahl when user has not chosen yet
DAHL_MODEL = os.getenv("DAHL_MODEL", "deepseek-ai/DeepSeek-V4-Flash-0731")
# Preferred provider for new users (they can switch in /settings); chain still falls back
AI_PROVIDER = os.getenv("AI_PROVIDER", "xkiro").strip().lower()
# Max images pulled from RSS and attached to a channel post
MAX_POST_IMAGES = int(os.getenv("MAX_POST_IMAGES", "3"))
# ============================================================
# Provider registry — OpenAI-compatible chat backends.
# Fallback order = AI_CHAIN (env) with per-user preferred first.
# ============================================================
PROVIDERS: dict[str, dict] = {
    "xkiro": {
        "label": "xKiro",
        "keys": _pkeys("xkiro", "XKIRO_API_KEY"),
        "base": os.getenv("XKIRO_BASE_URL", "https://api.xkiro.com/v1").rstrip("/"),
        # free-tier models only (premium pay-as-you-go needs wallet balance → 403)
        "model": os.getenv("XKIRO_MODEL", "mistralai/mistral-medium-3.5"),
        "models": [
            os.getenv("XKIRO_MODEL", "mistralai/mistral-medium-3.5"),
            "qwen/qwen3.7-plus:free",
            "minimax/minimax-m2.7:free",
            "mistralai/mistral-small-2603",
            "qwen/qwen3-max:free",
        ],
        "balance": "/usage",  # GET /v1/usage — wallet + free token allowance
    },
    "inception": {
        "label": "Inception",
        "keys": _pkeys("inception", "INCEPTION_API_KEY"),
        "base": os.getenv("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1").rstrip("/"),
        "model": os.getenv("INCEPTION_MODEL", "mercury-2.5"),
        "models": [
            os.getenv("INCEPTION_MODEL", "mercury-2.5"),
            "mercury-2",
        ],
        "balance": None,
    },
    "vyce": {
        "label": "Vyce AI",
        "keys": _pkeys("vyce", "VYCE_API_KEY"),
        "base": os.getenv("VYCE_BASE_URL", "https://vyceai.com/v1").rstrip("/"),
        # model ids are account-specific — auto-discovered from GET /v1/models
        "model": os.getenv("VYCE_MODEL", ""),
        "models": [m for m in [os.getenv("VYCE_MODEL", "")] if m],
        "discover": True,
        "balance": None,
    },
    "dahl": {
        "label": "Dahl",
        "keys": _pkeys("dahl", "DAHL_API_KEY"),
        "base": os.getenv("DAHL_BASE_URL", "https://inference.dahl.global/v1").rstrip("/"),
        "model": os.getenv("DAHL_MODEL", "deepseek-ai/DeepSeek-V4-Flash-0731"),
        # MiniMax removed: leaks chain-of-thought into the output
        "models": [
            os.getenv("DAHL_MODEL", "deepseek-ai/DeepSeek-V4-Flash-0731"),
            "zai-org/GLM-5.3-Flash",
        ],
        "balance": None,
    },
    "deepseek": {
        "label": "DeepSeek",
        "keys": _pkeys("deepseek", "DEEPSEEK_API_KEY"),
        "base": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "models": [os.getenv("DEEPSEEK_MODEL", "deepseek-chat")],
        "balance": None,
    },
}

# Providers kept out of the default chain until they have balance:
#   deepseek → 402 Insufficient Balance (re-add via AI_CHAIN env after top-up)
_default_chain = "xkiro,inception,vyce,dahl"
AI_CHAIN = [p.strip().lower() for p in os.getenv("AI_CHAIN", _default_chain).split(",") if p.strip()]
AI_CHAIN = [p for p in AI_CHAIN if p in PROVIDERS] or _default_chain.split(",")

# Health: provider::model -> {status: ok|busy|dead|transient, until: epoch, err: str}
AI_HEALTH: dict[str, dict] = {}
BUSY_COOLDOWN_SEC = int(os.getenv("BUSY_COOLDOWN_SEC", "180"))
DEAD_COOLDOWN_SEC = int(os.getenv("DEAD_COOLDOWN_SEC", "900"))
ALL_DOWN_RECHECK_SEC = int(os.getenv("ALL_DOWN_RECHECK_SEC", "300"))
ALL_DOWN_SINCE: float | None = None
AFFECTED_USERS: set[int] = set()
LAST_CLEANUP_TS: float = 0.0

# ---- Key pool: many keys per provider, round-robin + per-key cooldown ----
KEY_HEALTH: dict[str, dict] = {}   # masked-safe: keyed by provider::key_index -> {status, until, err}
KEY_RR: dict[str, int] = {}        # provider -> next key index
KEY_LOCK = threading.Lock()
KEY_BUSY_COOLDOWN_SEC = int(os.getenv("KEY_BUSY_COOLDOWN_SEC", "120"))
KEY_DEAD_COOLDOWN_SEC = int(os.getenv("KEY_DEAD_COOLDOWN_SEC", "1800"))
ENV_KEYS: dict[str, list] = {p: list(PROVIDERS[p].get("keys") or []) for p in PROVIDERS}


def _sync_primary_key(p: str):
    prov = PROVIDERS[p]
    ks = prov.get("keys") or []
    prov["key"] = ks[0] if ks else ""


for _p in PROVIDERS:
    _sync_primary_key(_p)


def mask_key(key: str) -> str:
    key = key or ""
    if len(key) <= 8:
        return (key[:2] + "…") if key else "—"
    return f"{key[:4]}…{key[-4:]}"


def all_keys(p: str) -> list:
    return list((PROVIDERS.get(p) or {}).get("keys") or [])


def _key_usable(p: str, idx: int) -> bool:
    h = KEY_HEALTH.get(f"{p}::{idx}")
    if not h:
        return True
    if h.get("status") in ("busy", "dead", "transient"):
        return time.time() >= float(h.get("until") or 0)
    return True


def mark_key(p: str, idx: int, err: str | None, status: str | None = None):
    key = f"{p}::{idx}"
    if not err:
        KEY_HEALTH[key] = {"status": "ok", "until": 0, "err": ""}
        return
    low = str(err).lower()
    if status is None:
        if "429" in low or "rate limit" in low or "concurrency" in low or "too many" in low:
            status = "busy"
        elif any(x in low for x in ("401", "402", "403", "insufficient", "balance", "quota", "invalid", "api key")):
            status = "dead"
        else:
            status = "transient"
    cool = {"busy": KEY_BUSY_COOLDOWN_SEC, "dead": KEY_DEAD_COOLDOWN_SEC}.get(status, 60)
    KEY_HEALTH[key] = {"status": status, "until": time.time() + cool, "err": str(err)[:200]}


def ordered_keys(p: str) -> list:
    """(idx, key) pairs: round-robin order, usable first; if none usable, still return all (optimistic)."""
    keys = all_keys(p)
    n = len(keys)
    if n == 0:
        return []
    start = KEY_RR.get(p, 0) % n
    idxs = [(start + i) % n for i in range(n)]
    usable = [i for i in idxs if _key_usable(p, i)]
    order = usable if usable else idxs  # if all cooling, retry soonest-cycling anyway
    return [(i, keys[i]) for i in order]


def bump_key(p: str, idx: int):
    n = len(all_keys(p)) or 1
    KEY_RR[p] = (idx + 1) % n


def reload_dynamic_keys():
    """Merge env keys + Supabase provider_keys into PROVIDERS[p]['keys']."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        rows = sb_get("provider_keys?enabled=eq.true&order=id.asc&limit=200")
    except Exception as e:
        # table missing until sql/05 is applied
        log.debug("reload_dynamic_keys: %s", e)
        return
    extra: dict[str, list] = {}
    for r in rows:
        p = (r.get("provider") or "").strip().lower()
        k = (r.get("api_key") or "").strip()
        if p in PROVIDERS and k:
            extra.setdefault(p, []).append(k)
    for p in PROVIDERS:
        merged = list(ENV_KEYS.get(p, [])) + extra.get(p, [])
        seen, out = set(), []
        for k in merged:
            if k and k not in seen:
                seen.add(k)
                out.append(k)
        PROVIDERS[p]["keys"] = out
        _sync_primary_key(p)

# Optional short line at the end of every post (user can override with /footer)
DEFAULT_CHANNEL_FOOTER = os.getenv("DEFAULT_CHANNEL_FOOTER", "").strip()
# If AI cannot translate (EN source), do NOT publish raw English to the channel
SKIP_EN_WHEN_AI_FAILS = os.getenv("SKIP_EN_WHEN_AI_FAILS", "true").lower() in ("1", "true", "yes")
# Tell the owner in private chat when AI/translation fails (rate-limited)
AI_FAIL_NOTIFY = os.getenv("AI_FAIL_NOTIFY", "true").lower() in ("1", "true", "yes")
AI_FAIL_NOTIFY_SEC = int(os.getenv("AI_FAIL_NOTIFY_SEC", "1800"))  # min gap between notifies
AI_FAIL_STAMPS: dict[int, float] = {}  # user_id -> last notify ts

BOT_VERSION = os.getenv("BOT_VERSION", "1.0.0")
SCAN_INTERVAL_SEC = int(os.getenv("SCAN_INTERVAL_SEC", "60"))
MAX_ITEMS_PER_SCAN = int(os.getenv("MAX_ITEMS_PER_SCAN", "12"))
MAX_FEED_ITEMS = int(os.getenv("MAX_FEED_ITEMS", "25"))
# Per source, how many NEW items we accept each scan (spread across feeds)
MAX_NEW_PER_SOURCE = int(os.getenv("MAX_NEW_PER_SOURCE", "2"))
DEFAULT_AUTO_PUBLISH = os.getenv("DEFAULT_AUTO_PUBLISH", "false").lower() in ("1", "true", "yes")
# Periodic round-up post of recently published channel news
DIGEST_ENABLED_DEFAULT = os.getenv("DIGEST_ENABLED", "true").lower() in ("1", "true", "yes")
DIGEST_INTERVAL_HOURS = int(os.getenv("DIGEST_INTERVAL_HOURS", "12"))
DIGEST_MAX_ITEMS = int(os.getenv("DIGEST_MAX_ITEMS", "15"))
# Housekeeping: delete already-handled rows older than N days (they are in Telegram already)
RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "1"))
CLEANUP_INTERVAL_SEC = int(os.getenv("CLEANUP_INTERVAL_SEC", "3600"))
AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.4"))
ADMIN_TELEGRAM_IDS = set()
for _p in (os.getenv("ADMIN_TELEGRAM_IDS") or "").split(","):
    _p = _p.strip()
    if _p.lstrip("-").isdigit():
        ADMIN_TELEGRAM_IDS.add(int(_p))

MAX_TG_MESSAGE = 4000
PARSE_MODE = "HTML"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("newsbot")

if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN is required")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required")

bot = telebot.TeleBot(BOT_TOKEN, num_threads=4)
bot.timeout = 30

# In-memory pending channel bind (user_id -> awaiting channel)
awaiting_channel: set[int] = set()
# Avoid double-processing the same draft button
processing_drafts: set[int] = set()

# Captured discussion-group mirrors of channel posts:
# group_chat_id -> list of (ts, group_message_id, sender_channel_id)
MIRROR_IDS: dict[int, list] = {}
MIRROR_LOCK = threading.Lock()
DISCUSSION_MIRROR_WAIT_SEC = float(os.getenv("DISCUSSION_MIRROR_WAIT_SEC", "10"))


def _remember_mirror(group_chat_id: int, msg_id: int, channel_id: int | None, ts: float | None = None):
    with MIRROR_LOCK:
        lst = MIRROR_IDS.setdefault(int(group_chat_id), [])
        lst.append((ts or time.time(), int(msg_id), int(channel_id) if channel_id else None))
        if len(lst) > 30:
            del lst[:-30]


def _wait_mirror(group_chat_id: int, channel_id: int | None, since_ts: float,
                 wait_sec: float = DISCUSSION_MIRROR_WAIT_SEC):
    """Poll for the discussion-group copy of the just-published channel post."""
    deadline = time.time() + max(0.0, wait_sec)
    best = None
    while time.time() < deadline:
        with MIRROR_LOCK:
            for ts, mid, ch in MIRROR_IDS.get(int(group_chat_id), []):
                if ts < since_ts:
                    continue
                if channel_id and ch and int(ch) != int(channel_id):
                    continue
                if best is None or mid > best:
                    best = mid
        if best is not None:
            # small grace so Telegram finishes linking the thread
            time.sleep(0.4)
            return best
        time.sleep(0.5)
    return best


# ============================================================
# Supabase helpers
# ============================================================

def sb_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def sb_get(path: str, timeout: float = 15.0):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = httpx.get(url, headers=sb_headers(), timeout=timeout)
    r.raise_for_status()
    return r.json()


def sb_post(path: str, payload, timeout: float = 15.0):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = httpx.post(url, headers=sb_headers(), json=payload, timeout=timeout)
    if r.status_code >= 400:
        log.error("SB POST %s -> %s %s", path, r.status_code, r.text[:300])
    r.raise_for_status()
    return r.json()


def sb_patch(path: str, payload, timeout: float = 15.0):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = httpx.patch(url, headers=sb_headers(), json=payload, timeout=timeout)
    if r.status_code >= 400:
        log.error("SB PATCH %s -> %s %s", path, r.status_code, r.text[:300])
    r.raise_for_status()
    return r.json()


def sb_delete(path: str, timeout: float = 20.0):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    h = sb_headers()
    h["Prefer"] = "count=exact"
    r = httpx.delete(url, headers=h, timeout=timeout)
    if r.status_code >= 400:
        log.error("SB DELETE %s -> %s %s", path, r.status_code, r.text[:300])
    r.raise_for_status()
    cr = r.headers.get("content-range") or ""
    if "/" in cr:
        try:
            return int(cr.split("/")[1])
        except Exception:
            pass
    return 0


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================
# Users / sources / articles
# ============================================================

def get_user(tg_id: int):
    rows = sb_get(f"bot_users?telegram_id=eq.{tg_id}&limit=1")
    return rows[0] if rows else None


def upsert_user(message):
    tg_id = message.from_user.id
    username = message.from_user.username or ""
    full = (message.from_user.first_name or "") + " " + (message.from_user.last_name or "")
    full = full.strip()[:120]
    existing = get_user(tg_id)
    if existing:
        sb_patch(
            f"bot_users?telegram_id=eq.{tg_id}",
            {"username": username, "full_name": full, "updated_at": utcnow_iso()},
        )
        return get_user(tg_id)
    sb_post(
        "bot_users",
        [{
            "telegram_id": tg_id,
            "username": username,
            "full_name": full,
            "auto_publish": DEFAULT_AUTO_PUBLISH,
        }],
    )
    # Best-effort extra columns (run sql/02_ai_images_footer.sql first)
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{tg_id}",
            {
                "ai_provider": AI_PROVIDER if AI_PROVIDER in ("deepseek", "dahl") else "deepseek",
                "ai_model": DAHL_MODEL if AI_PROVIDER == "dahl" else DEEPSEEK_MODEL,
                "channel_footer": DEFAULT_CHANNEL_FOOTER,
                "updated_at": utcnow_iso(),
            },
        )
    except Exception as e:
        log.warning("user AI columns patch: %s", e)
    seed_user_sources(tg_id)
    return get_user(tg_id)


def seed_user_sources(tg_id: int):
    """Insert global defaults as user-scoped enabled sources (copy-on-first-use)."""
    try:
        existing = sb_get(f"sources?user_id=eq.{tg_id}&limit=1")
        if existing:
            return
        payload = []
        for s in DEFAULT_SOURCES:
            payload.append({
                "user_id": tg_id,
                "name": s["name"],
                "url": s["url"],
                "lang": s.get("lang", "en"),
                "category": s.get("category", "world"),
                "enabled": True,
            })
        # unique(user_id,url) — insert one-by-one to survive partial conflicts
        for row in payload:
            try:
                sb_post("sources", [row])
            except Exception as e:
                log.warning("seed source %s: %s", row["name"], e)
    except Exception as e:
        log.error("seed_user_sources: %s", e)


def ensure_global_sources():
    """Optional admin bootstrap: seed user_id is null rows (not used by default)."""
    for s in DEFAULT_SOURCES:
        url = s["url"].replace("%", "%25")
        rows = sb_get(f"sources?user_id=is.null&url=eq.{url}&limit=1")
        if not rows:
            try:
                sb_post("sources", [{
                    "user_id": None,
                    "name": s["name"],
                    "url": s["url"],
                    "lang": s.get("lang", "en"),
                    "category": s.get("category", "world"),
                    "enabled": True,
                }])
            except Exception as e:
                log.warning("global source %s: %s", s["name"], e)


def url_hash(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]


def article_guid(url: str, fallback: str = "") -> str:
    """Stable id. Prefer URL without RSS fragment noise (#0, #xtor=...)."""
    base = (fallback or url or "").strip()
    if url:
        base = url.strip()
    # strip fragment used by some feeds (BBC #0)
    if "#" in base:
        base = base.split("#", 1)[0]
    return base[:500]


def pg_quote(value: str) -> str:
    """Encode a filter value for PostgREST so #, &, /, ? do not break the URL."""
    return quote(str(value), safe="")


def find_article_by_guid(guid: str):
    rows = sb_get(f"articles?guid=eq.{pg_quote(guid)}&limit=1")
    return rows[0] if rows else None


def find_draft(user_id: int, article_id: int):
    rows = sb_get(f"drafts?user_id=eq.{int(user_id)}&article_id=eq.{int(article_id)}&limit=1")
    return rows[0] if rows else None


def extract_feed_images(item, limit: int = 3) -> list:
    """Collect up to `limit` http(s) image URLs from an RSS entry."""
    urls = []

    def add(u):
        u = (u or "").strip()
        if not u.startswith("http"):
            return
        if any(x in u.lower() for x in (".svg", "logo", "sprite", "1x1", "pixel")):
            return
        if u not in urls:
            urls.append(u)

    for enc in item.get("enclosures") or []:
        href = enc.get("href") or enc.get("url") or ""
        typ = (enc.get("type") or "").lower()
        if "image" in typ or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", href, re.I):
            add(href)

    mc = item.get("media_content") or []
    if isinstance(mc, dict):
        mc = [mc]
    for m in mc:
        if isinstance(m, dict):
            add(m.get("url") or m.get("href"))

    for lk in item.get("links") or []:
        if isinstance(lk, dict):
            rel = (lk.get("rel") or "").lower()
            typ = (lk.get("type") or "").lower()
            href = lk.get("href") or ""
            if rel == "enclosure" or "image" in typ or re.search(r"\.(jpe?g|png|webp)(\?|$)", href, re.I):
                add(href)

    for m in re.findall(r'https?://[^\s"\'<>]+\.(?:jpe?g|png|webp)(?:\?[^\s"\'<>]*)?', item.get("summary") or "", re.I):
        add(m)

    return urls[: max(0, limit)]


def ensure_article(source_row: dict, item: dict):
    title = strip_html(item.get("title") or "").strip()
    link = (item.get("link") or "").strip()
    if not title or not link:
        return None
    guid = article_guid(link, item.get("id") or item.get("guid") or link)
    existing = find_article_by_guid(guid)
    if existing:
        # Backfill images once if column empty
        if not existing.get("images"):
            imgs = extract_feed_images(item, MAX_POST_IMAGES)
            if imgs:
                try:
                    sb_patch(f"articles?id=eq.{int(existing['id'])}", {"images": imgs})
                    existing["images"] = imgs
                except Exception:
                    pass
        return existing
    summary = strip_html(item.get("summary") or item.get("description") or "")[:1200]
    images = extract_feed_images(item, MAX_POST_IMAGES)
    published = None
    if item.get("published_parsed"):
        try:
            published = datetime(*item.published_parsed[:6], tzinfo=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except Exception:
            published = None
    payload = [{
        "source_id": source_row.get("id"),
        "guid": guid,
        "url": link,
        "title": title[:500],
        "summary": summary,
        "source_lang": source_row.get("lang") or "en",
        "source_name": source_row.get("name") or "",
        "category": source_row.get("category") or "world",
        "published_at": published,
        "images": images,
    }]
    try:
        rows = sb_post("articles", payload)
        return rows[0] if rows else find_article_by_guid(guid)
    except Exception as e:
        log.warning("insert article with images: %s", e)
        # Retry without images if column missing
        try:
            payload2 = [{k: v for k, v in payload[0].items() if k != "images"}]
            rows = sb_post("articles", payload2)
            return rows[0] if rows else find_article_by_guid(guid)
        except Exception as e2:
            log.warning("insert article: %s", e2)
            return find_article_by_guid(guid)


# ============================================================
# Text / AI
# ============================================================

def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def _health_get(provider: str, model: str) -> dict:
    return AI_HEALTH.get(f"{provider}::{model}") or {"status": "unknown", "until": 0, "err": ""}


def _health_usable(provider: str, model: str) -> bool:
    h = _health_get(provider, model)
    st = h.get("status")
    if st in ("ok", "unknown"):
        return True
    if st in ("busy", "transient", "dead"):
        return time.time() >= float(h.get("until") or 0)
    return True


def mark_ai_health(*args):
    """
    mark_ai_health(provider, model, error|None)          # error None => ok
    mark_ai_health(provider, model, error, status=...)   # busy|dead|transient
    mark_ai_health("dahl::model-id", error|None)
    """
    status = None
    if len(args) == 4:
        provider, model, error, status = args
    elif len(args) == 3:
        provider, model, error = args
    elif len(args) == 2:
        key, error = args
        provider, _, model = str(key).partition("::")
    else:
        AI_HEALTH[str(args[0])] = {"status": "dead", "until": time.time() + DEAD_COOLDOWN_SEC, "err": "unknown"}
        return
    key = f"{provider}::{model}"
    if not error:
        AI_HEALTH[key] = {"status": "ok", "until": 0, "err": ""}
        return
    err = str(error)[:240]
    if status is None:
        low = err.lower()
        if "429" in low or "concurrency" in low or "rate limit" in low or "too many" in low:
            status = "busy"
        elif "401" in low or "402" in low or "403" in low or "insufficient" in low or "balance" in low or "invalid" in low or "api key" in low:
            status = "dead"
        else:
            status = "transient"
    cool = {"busy": BUSY_COOLDOWN_SEC, "dead": DEAD_COOLDOWN_SEC}.get(status, 60)
    AI_HEALTH[key] = {"status": status, "until": time.time() + cool, "err": err}


_DISCOVER_CACHE: dict[str, list[str]] = {}
_DISCOVER_LOCK = threading.Lock()


def discover_models(p: str, force: bool = False) -> list[str]:
    """Fetch GET /v1/models for providers flagged discover (e.g. Vyce) and cache ids."""
    prov = PROVIDERS.get(p) or {}
    if not prov.get("discover") or not prov.get("key"):
        return prov.get("models", [])
    with _DISCOVER_LOCK:
        if not force and p in _DISCOVER_CACHE:
            return _DISCOVER_CACHE[p]
    try:
        r = httpx.get(f"{prov['base']}/models",
                      headers={"Authorization": f"Bearer {prov['key']}", "Accept": "application/json"},
                      timeout=15.0, follow_redirects=True)
        if r.status_code != 200:
            log.warning("discover %s HTTP %s", p, r.status_code)
            return prov.get("models", [])
        data = r.json()
        items = data.get("data") if isinstance(data, dict) else data
        ids = []
        for it in items or []:
            mid = (it.get("id") if isinstance(it, dict) else str(it)) or ""
            mid = mid.strip()
            if not mid or mid in ids:
                continue
            low = mid.lower()
            if any(x in low for x in ("embed", "tts", "whisper", "image", "dall", "moderation", "audio")):
                continue
            ids.append(mid)
        # prefer chat-ish names first
        ids.sort(key=lambda m: (0 if any(k in m.lower() for k in ("gpt", "claude", "deepseek", "gemini", "chat")) else 1, m))
        ids = ids[:8]
        with _DISCOVER_LOCK:
            _DISCOVER_CACHE[p] = ids
        prov["models"] = ids
        if ids and not prov.get("model"):
            prov["model"] = ids[0]
        log.info("discovered %d %s models: %s", len(ids), p, ", ".join(ids[:4]))
        return ids
    except Exception as e:
        log.warning("discover %s failed: %s", p, e)
        return prov.get("models", [])


def chain_candidates(user: dict | None = None) -> list[tuple[str, str]]:
    """Ordered (provider, model) pairs: user preferred first, then AI_CHAIN."""
    pref_provider = ((user or {}).get("ai_provider") or AI_PROVIDER or "").strip().lower()
    pref_model = ((user or {}).get("ai_model") or "").strip()
    out: list[tuple[str, str]] = []

    def models_of(p: str) -> list[str]:
        prov = PROVIDERS[p]
        ms = list(prov.get("models") or [])
        if prov.get("discover") and not ms:
            ms = discover_models(p)
        if prov.get("model") and prov["model"] not in ms:
            ms.insert(0, prov["model"])
        return [m for m in ms if m]

    def add(p: str, m: str):
        if p not in PROVIDERS:
            return
        if not PROVIDERS[p]["key"]:
            return
        pair = (p, m or PROVIDERS[p]["model"])
        if pair[1] and pair not in out:
            out.append(pair)

    if pref_provider in PROVIDERS and PROVIDERS[pref_provider]["key"]:
        add(pref_provider, pref_model)
        for m in models_of(pref_provider):
            add(pref_provider, m)
    for p in AI_CHAIN:
        if p == pref_provider:
            continue
        for m in models_of(p):
            add(p, m)
    return out


def usable_chain(user: dict | None = None) -> list[tuple[str, str]]:
    return [(p, m) for p, m in chain_candidates(user) if _health_usable(p, m)]


def resolve_ai(user: dict | None) -> tuple[str, str, str, str]:
    """First usable (provider, base_url, api_key, model) for display / single calls."""
    cands = chain_candidates(user)
    for p, m in cands:
        if _health_usable(p, m):
            return (p, PROVIDERS[p]["base"], PROVIDERS[p]["key"], m)
    if cands:
        p, m = cands[0]
        return (p, PROVIDERS[p]["base"], PROVIDERS[p]["key"], m)
    return ("none", "", "", "")


def note_all_down(user_id: int | None = None):
    global ALL_DOWN_SINCE
    if user_id:
        AFFECTED_USERS.add(int(user_id))
    if ALL_DOWN_SINCE is None:
        ALL_DOWN_SINCE = time.time()
        log.warning("ALL AI providers failed — auto-recheck in %ss", ALL_DOWN_RECHECK_SEC)


def maybe_recover_all_down():
    """Called from scanner loop: if all were down, re-probe after cooldown."""
    global ALL_DOWN_SINCE
    if ALL_DOWN_SINCE is None:
        return
    if time.time() - ALL_DOWN_SINCE < ALL_DOWN_RECHECK_SEC:
        return
    ALL_DOWN_SINCE = None
    for key in list(AI_HEALTH.keys()):
        h = AI_HEALTH[key]
        if h.get("until") and time.time() >= float(h["until"]):
            AI_HEALTH[key] = {"status": "unknown", "until": 0, "err": ""}
    # quick probe of usable chain head
    for p, m in chain_candidates(None):
        ok, detail = _probe_model(PROVIDERS[p]["base"], PROVIDERS[p]["key"], m)
        mark_ai_health(p, m, None if ok else detail)
        if ok:
            log.info("AI recovered: %s · %s", p, m)
            for uid in list(AFFECTED_USERS):
                try:
                    bot.send_message(
                        uid,
                        f"✅ هوش مصنوعی دوباره در دسترس است: {PROVIDERS[p]['label']} · {m}\n"
                        "خبرهای انگلیسی مجدداً ترجمه و منتشر می‌شوند.",
                    )
                except Exception:
                    pass
                AFFECTED_USERS.discard(uid)
            break


def looks_persian(text: str) -> bool:
    return bool(re.search(r"[؀-ۿ]", text or ""))


def strip_md(s: str) -> str:
    """Remove markdown emphasis markers so HTML mode does not show literal **."""
    s = s or ""
    s = re.sub(r"\*\*\s*(.+?)\s*\*\*", r"\1", s, flags=re.S)
    s = re.sub(r"__\s*(.+?)\s*__", r"\1", s, flags=re.S)
    s = re.sub(r"(?<!\w)\*\s*([^\n*]+?)\s*\*(?!\w)", r"\1", s)
    s = re.sub(r"(?<!\w)_\s*([^_\n]+?)\s*_(?!\w)", r"\1", s)
    # leftover bullets from model formatting
    s = re.sub(r"(?m)^\s*[-•]\s+", "• ", s)
    return s


def clean_ai_output(raw: str) -> str:
    """Strip model reasoning/CoT; keep only the Persian news post body."""
    s = (raw or "").strip()
    if not s:
        return ""
    s = re.sub(r"^```(?:\w+)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    # Drop common reasoning wrappers
    s = re.sub(r"<\|.*?\|>", "", s, flags=re.S)
    s = re.sub(r"(?is)\b(?:thinking|thought|reasoning)\b\s*:", "", s)

    lines = [ln.rstrip() for ln in s.splitlines()]
    start = None
    for i, ln in enumerate(lines):
        if looks_persian(ln) and len(ln.strip()) >= 8:
            # skip pure meta lines
            low = ln.lower()
            if any(x in low for x in ("output only", "i need to", "let me", "system:", "user:", "assistant:")):
                continue
            start = i
            break
    if start is None:
        # maybe whole block is one para without newlines but has Persian
        if looks_persian(s) and not re.search(r"(?i)\bI need to\b|\bLet me\b|\bbreak it down\b", s):
            return s[:MAX_TG_MESSAGE]
        return ""

    out_lines = []
    for ln in lines[start:]:
        low = ln.lower().strip()
        if not low:
            if out_lines:
                out_lines.append("")
            continue
        # stop if model starts explaining again in English
        if out_lines and re.match(r"(?i)^(i need|let me|now i|the user|note:|explanation|translation:)", low):
            break
        if re.match(r"(?i)^(i need|let me|now i|the user|system:|user:|assistant:)", low) and not looks_persian(ln):
            continue
        out_lines.append(ln)
    text = "\n".join(out_lines).strip()
    text = strip_md(text)
    # remove leftover English title duplicates at start
    return text[:MAX_TG_MESSAGE]


CATEGORY_TAG_FA = {
    "world": "جهان", "news": "اخبار", "tech": "تکنولوژی", "sports": "ورزش",
    "crypto": "رمزارز", "iran": "ایران", "entertainment": "سرگرمی", "science": "علم",
    "gaming": "گیم", "music": "موسیقی", "economy": "اقتصاد", "business": "اقتصاد",
    "podcast": "پادکست", "cinema": "سینما", "movies": "سینما", "travel": "سفر",
    "photography": "عکاسی", "food": "غذا", "education": "آموزش", "art": "هنر",
    "meme": "سرگرمی", "politics": "سیاست", "health": "سلامت",
}

# (trigger keywords [en+fa], persian tag)
KEYWORD_TAGS = [
    (("جنگ", "موشک", "حمله", "بمب", "اسرائیل", "اوکراین", "درگیری", "تلفات", "پدافند",
      "war", "strike", "missile", "attack", "israel", "ukraine", "conflict", "airstrike", "ceasefire"), "جنگ"),
    (("هوش مصنوعی", "مدل زبانی", "چت‌بات", " ai ", "openai", "chatgpt", "gemini", "deepseek", "claude", "llm"), "هوش_مصنوعی"),
    (("بیت‌کوین", "بیت کوین", "ارز دیجیتال", "توکن", "بلاکچین", "رمزارز", "bitcoin", "btc", "crypto", "ethereum", "token"), "رمزارز"),
    (("فوتبال", "لیگ", "گل ", "تیم ملی", "ورزش", "مسابقه", "football", "soccer", "match", "league", "goal"), "ورزش"),
    (("فیلم", "سینما", "سریال", "بازیگر", "netflix", "movie", "series", "cinema", "actor", "trailer"), "سینما"),
    (("فضا", "ماهواره", "تلسکوپ", "سیاره", "ناسا", "موشک فضایی", "nasa", "spacex", "satellite", "rocket", "space", "telescope"), "فضا"),
    (("تورم", "دلار", "سکه", "بازار", "اقتصاد", "سرمایه", "inflation", "economy", "market", "dollar", "stock", "gold"), "اقتصاد"),
    (("گوشی", "اپل", "سامسونگ", "لپ‌تاپ", "اپلیکیشن", "phone", "apple", "samsung", "laptop", "app", "android", "ios"), "تکنولوژی"),
    (("انتخابات", "رئیس‌جمهور", "پارلمان", "سیاست", "sanction", "تحریم", "election", "president", "parliament", "politics"), "سیاست"),
    (("زلزله", "سیل", "آتش‌سوزی", "فاجعه", "earthquake", "flood", "wildfire", "disaster"), "حوادث"),
]


def _tagify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[\s\-\.]+", "_", s)
    s = re.sub(r"[^0-9a-z_\u0600-\u06FF\uFB8C-\uFDFF]", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:40]


def make_hashtags(source_name: str, category: str, title: str, summary: str) -> list:
    """Agency tag (most important) + category tag + keyword tags. Capped, de-duped."""
    tags: list[str] = []
    ag = _tagify(source_name)
    if ag:
        tags.append("#" + ag)
    ct = CATEGORY_TAG_FA.get((category or "").lower())
    if ct:
        tags.append("#" + ct)
    text = f" {title} {summary} ".lower()
    for kws, tag in KEYWORD_TAGS:
        if any(k in text for k in kws):
            t = "#" + tag
            if t not in tags:
                tags.append(t)
        if len(tags) >= 5:
            break
    seen, out = set(), []
    for t in tags:
        if t and len(t) > 2 and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:5]


def ai_persian_post(
    title: str,
    summary: str,
    source_name: str,
    source_lang: str,
    url: str,
    user: dict | None = None,
    channel_footer: str | None = None,
    category: str = "",
) -> tuple[str, bool]:
    """Return (post_text, used_ai). Always prefer Persian via provider."""
    footer = channel_footer if channel_footer is not None else (
        (user or {}).get("channel_footer") or DEFAULT_CHANNEL_FOOTER or ""
    )
    hashtags = make_hashtags(source_name, category, title, summary)
    fallback = format_post_fa(
        title_fa=title,
        body_fa=summary[:400] or title,
        source_name=source_name,
        url=url,
        footer=footer,
        hashtags=hashtags,
    )

    is_fa = (source_lang or "").lower().startswith("fa")
    if is_fa:
        system = (
            "تو یک ویراستار خبری فارسی هستی. "
            "خروجی باید حتماً فارسی باشد. "
            "یک پست کوتاه کانال تلگرام بنویس: تیتر فارسی روان (یک خط) + ۲ تا ۴ خط خلاصه بی‌طرفانه. "
            "بدون تفسیر شخصی، بدون ادعای جدید، بدون لینک اضافه. فقط همان تیتر و خلاصه را برگردان. "
            "مهم: فقط متن نهایی پست را بنویس؛ هیچ توضیح، فکر کردن یا متن انگلیسی ننویس. "
            "از علامت‌های مارک‌داون مثل ** یا __ استفاده نکن."
        )
    else:
        system = (
            "You are a Persian (Farsi) news editor for Telegram.\n"
            "OUTPUT RULES (strict):\n"
            "1) Reply with ONLY the final Persian post body.\n"
            "2) Line 1: Persian headline.\n"
            "3) Next 2-4 lines: short neutral Persian summary.\n"
            "4) NO thinking, NO steps, NO English explanation, NO markdown fences, NO ** or __ emphasis.\n"
            "5) Start your reply with Persian characters immediately.\n"
            "6) No URLs, no 'Source:', no invented facts."
        )
    user_msg = (
        f"Source name: {source_name}\n"
        f"Source language: {source_lang}\n"
        f"Original title: {title}\n"
        f"Lead/summary: {summary[:1500]}"
    )
    try:
        content, provider, model = chat_completion_chain(user, system, user_msg)
        cleaned = clean_ai_output(content)
        if not cleaned:
            log.warning("AI empty/unclean provider=%s model=%s", provider, model)
            mark_ai_health(provider, model, "empty/unclean output")
            note_all_down((user or {}).get("telegram_id"))
            return fallback, False
        if not looks_persian(cleaned):
            log.warning("AI non-Persian provider=%s model=%s", provider, model)
            mark_ai_health(provider, model, "non-Persian output", "transient")
            # one more attempt on the chain with stricter prompt
            try:
                content, provider, model = chat_completion_chain(
                    user,
                    system + "\nCRITICAL: Reply MUST start with Persian script. No English at all.",
                    user_msg,
                )
                cleaned = clean_ai_output(content)
            except Exception as e2:
                log.warning("AI retry failed: %s", e2)
        if not looks_persian(cleaned):
            log.error("AI still not Persian — using fallback")
            mark_ai_health(provider, model, "non-Persian output after retry", "transient")
            note_all_down((user or {}).get("telegram_id"))
            return fallback, False
        if re.search(r"(?i)I need to|Let me break|as an AI|here is the translation", cleaned[:400]):
            mark_ai_health(provider, model, "reasoning leak", "transient")
            cleaned = clean_ai_output(cleaned)
            if not looks_persian(cleaned):
                note_all_down((user or {}).get("telegram_id"))
                return fallback, False
        mark_ai_health(provider, model, None)
        lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
        title_fa = lines[0].strip("»«\"' ") if lines else title
        body_fa = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
        if not body_fa:
            body_fa = cleaned
        return format_post_fa(
            title_fa=title_fa,
            body_fa=body_fa,
            source_name=source_name,
            url=url,
            footer=footer,
            hashtags=hashtags,
        ), True
    except Exception as e:
        log.warning("AI chain exhausted: %s", e)
        note_all_down((user or {}).get("telegram_id"))
        return fallback, False


def notify_ai_failure(user_id: int, reason: str):
    if not AI_FAIL_NOTIFY or not user_id:
        return
    now = time.time()
    last = AI_FAIL_STAMPS.get(user_id) or 0
    if now - last < AI_FAIL_NOTIFY_SEC:
        return
    AI_FAIL_STAMPS[user_id] = now
    try:
        bot.send_message(
            user_id,
            "⚠️ خطا در ترجمه/هوش مصنوعی\n\n"
            f"{reason}\n\n"
            "همهٔ ارائه‌دهنده‌های زنجیره (xKiro/Inception/Vyce/Dahl/DeepSeek) پاسخ ندادند.\n"
            f"تست خودکار مجدد تا {ALL_DOWN_RECHECK_SEC // 60} دقیقه دیگر انجام می‌شود.\n"
            "پست‌های انگلیسی موقتاً منتشر نمی‌شوند (فقط فارسی).\n"
            "دستی: /aicheck  ·  /testai  ·  /balance",
        )
    except Exception as e:
        log.warning("notify_ai_failure: %s", e)


def provider_available(provider: str) -> bool:
    p = (provider or "").strip().lower()
    if p in PROVIDERS:
        return bool(PROVIDERS[p]["key"])
    return any(v["key"] for v in PROVIDERS.values())


class AIError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def chat_completion(base_url: str, api_key: str, model: str, system: str, user_msg: str,
                    timeout: float = 45.0) -> str:
    if not api_key:
        raise AIError("AI API key missing", 401)
    r = httpx.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "temperature": AI_TEMPERATURE,
            "max_tokens": AI_MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
        },
        timeout=timeout,
    )
    if r.status_code >= 400:
        raise AIError(f"HTTP {r.status_code}: {r.text[:240]}", r.status_code)
    data = r.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return content.strip()


def chat_completion_chain(user: dict | None, system: str, user_msg: str,
                          timeout: float = 45.0) -> tuple[str, str, str]:
    """
    Try (provider, model) in chain order; for each, rotate through that
    provider's key pool (round-robin, skipping keys in cooldown) until one works.
    Returns (content, provider, model). Raises AIError if everything fails.
    """
    cands = usable_chain(user) or chain_candidates(user)
    if not cands:
        raise AIError("no AI provider keys configured", 0)
    last_err = "no candidates"
    for p, m in cands:
        keys = ordered_keys(p)
        if not keys:
            continue
        for idx, key in keys:
            try:
                content = chat_completion(PROVIDERS[p]["base"], key, m, system, user_msg, timeout)
                if not content:
                    mark_key(p, idx, "empty response", "transient")
                    last_err = f"{p}:{m}#{idx} empty"
                    continue
                mark_key(p, idx, None)
                mark_ai_health(p, m, None)
                bump_key(p, idx)
                return content, p, m
            except AIError as e:
                last_err = f"{p}:{m}#{idx} {e}"
                st = e.status
                if st == 429:
                    mark_key(p, idx, str(e), "busy")
                    mark_ai_health(p, m, str(e), "busy")
                elif st in (401, 402, 403):
                    mark_key(p, idx, str(e), "dead")   # this key exhausted → next key
                elif st == 404:
                    mark_ai_health(p, m, str(e), "dead")  # bad model, not the key
                    break  # stop trying keys for this model; go to next model
                else:
                    mark_key(p, idx, str(e), "transient")
                log.warning("AI chain step failed %s", last_err)
            except Exception as e:
                last_err = f"{p}:{m}#{idx} {e}"
                mark_key(p, idx, str(e), "transient")
                log.warning("AI chain exception %s", last_err)
    raise AIError(last_err, 0)


def ai_full_persian(
    title: str,
    summary: str,
    source_name: str,
    source_lang: str,
    url: str,
    user: dict | None = None,
    short_post: str = "",
) -> tuple[str, bool]:
    """Longer Persian body for the discussion/comment group (not the channel teaser)."""
    raw = strip_html(summary or "")[:2500]
    fallback = (raw or title or short_post or "").strip()
    if short_post and looks_persian(short_post) and len(fallback) < 200:
        fallback = short_post
    is_fa = (source_lang or "").lower().startswith("fa")
    if is_fa:
        system = (
            "متن کامل و روان فارسی همان خبر را بنویس (۶ تا ۱۲ خط). "
            "فقط بازنویسی/ترجمه؛ اطلاعات جدید اضافه نکن. خروجی فقط متن فارسی، بدون تیتر منبع و لینک. "
            "بدون مارک‌داون ** یا __."
        )
    else:
        system = (
            "You are a Persian news editor. Write a FULL Persian (Farsi) translation/rewrite "
            "of this news item for a Telegram discussion comment.\n"
            "RULES:\n"
            "1) Entirely Persian script.\n"
            "2) 6–12 short lines covering the main facts from title + lead.\n"
            "3) Do not invent facts. No English headline. No URLs.\n"
            "4) Return ONLY the Persian body text. No markdown ** or __."
        )
    user_msg = (
        f"Source: {source_name}\nTitle: {title}\nLead: {raw or summary[:2000]}\n"
        f"Short channel post (do not copy, expand instead):\n{short_post[:600]}"
    )
    try:
        content, _p, _m = chat_completion_chain(user, system, user_msg)
        cleaned = strip_md(clean_ai_output(content))
        if not cleaned or not looks_persian(cleaned):
            return fallback, False
        return cleaned[:MAX_TG_MESSAGE], True
    except Exception as e:
        log.warning("ai_full_persian failed: %s", e)
        return fallback, False


def discussion_publish(user: dict, draft: dict, full_text: str, channel_message_id: str,
                       since_ts: float | None = None):
    """
    Send FULL text into the linked discussion group as a COMMENT under the channel post.

    Order matters: the channel post is already published before this runs.
    The group-local id of the mirrored post is captured from live updates
    (on_mirror_post); replying to the channel id alone often hits the wrong
    or a missing message because group ids differ from channel ids.
    """
    gchat = user.get("discussion_chat_id")
    if not gchat:
        log.warning("discussion_publish skipped: no discussion_chat_id for user %s", user.get("telegram_id"))
        return False
    body = (full_text or draft.get("full_text") or draft.get("fa_text") or "").strip()
    if not body:
        log.warning("discussion_publish skipped: empty full text draft=%s", draft.get("id"))
        return False
    try:
        gchat = int(gchat)
    except Exception:
        log.warning("discussion_publish bad chat id: %s", gchat)
        return False

    channel_id = user.get("channel_id")
    try:
        channel_id = int(channel_id) if channel_id else None
    except Exception:
        channel_id = None

    mid = None
    try:
        mid = int(channel_message_id) if channel_message_id else None
    except Exception:
        mid = None

    # Wait for the mirror of THIS post (or the newest mirror after publish time)
    mirror_mid = _wait_mirror(gchat, channel_id, since_ts if since_ts is not None else time.time())
    if mirror_mid:
        log.info("discussion mirror id group=%s channel_mid=%s → group_mid=%s",
                 gchat, mid, mirror_mid)
    else:
        log.warning("discussion mirror not captured group=%s channel_mid=%s (try direct ids)", gchat, mid)

    attempts = []
    targets = []
    if mirror_mid:
        targets.append(("mirror", mirror_mid))
    if mid and (not mirror_mid or mid != mirror_mid):
        targets.append(("channel", mid))

    for kind, tid in targets:
        attempts.append({"reply_to_message_id": tid, "_kind": kind})
        attempts.append({"reply_to_message_id": tid, "message_thread_id": tid, "_kind": kind})
        attempts.append({"reply_to_message_id": tid, "message_thread_id": 1, "_kind": kind})

    last_err = None
    for kw in attempts:
        kw.pop("_wait", None)
        kind = kw.pop("_kind", "?")
        try:
            bot.send_message(gchat, body, **kw)
            log.info("discussion comment OK group=%s kind=%s kwargs=%s", gchat, kind, kw)
            return True
        except Exception as e:
            last_err = e
            log.warning("discussion attempt failed kind=%s (%s): %s", kind, kw, e)

    def _hint_for(err) -> str:
        s = str(err or "")
        if "message to be replied not found" in s or "message to forward not found" in s:
            return (
                "🔑 ربات پستِ کانال را در این گروه نمی‌بیند، پس نمی‌تواند زیر آن کامنت بگذارد.\n\n"
                "معمولاً یکی از این دو:\n"
                "۱) گروهِ بست‌شده همان گروه Discussion کانال نیست → /discussion off سپس /discussion @گروه_درست\n"
                "۲) Privacy Mode → BotFather: /setprivacy → Disable، سپس ربات را از گروه **Remove** کنید\n"
                "   (فقط برداشتن ادمینی کافی نیست) و دوباره اضافه و Admin کنید\n\n"
                "۳) یک پست **جدید** منتشر کنید (پست قدیمی کامنت نمی‌گیرد)\n"
                "۴) برای تشخیص: /discussion diag"
            )
        if "not enough rights" in s or "kicked" in s or "CHAT_ADMIN" in s:
            return "ربات را در گروه ادمین کنید (حداقل Can Send Messages)."
        if "chat not found" in s:
            return "/discussion @group را دوباره بزنید؛ chat_id نادرست است."
        return "ربات ادمین گروه است؟ /discussion درست ست شده؟"

    # Fallback: standalone message in the group (visible, but may not sit in the thread)
    for extra in ({}, {"message_thread_id": 1}):
        try:
            msg = bot.send_message(gchat, body, **extra)
            log.info("discussion standalone OK group=%s msg=%s", gchat, getattr(msg, "message_id", "?"))
            try:
                owner = user.get("telegram_id")
                if owner and mid:
                    bot.send_message(
                        owner,
                        "⚠️ متن کامل به‌صورت پیام معمولی در گروه رفت، نه کامنت زیر پست.\n"
                        f"دلیل reply: {last_err}\n\n" + _hint_for(last_err),
                    )
            except Exception:
                pass
            return True
        except Exception as e:
            last_err = e
            log.warning("discussion standalone failed (%s): %s", extra, e)

    log.error("discussion_publish FAILED group=%s: %s", gchat, last_err)
    try:
        owner = user.get("telegram_id")
        if owner:
            bot.send_message(
                owner,
                f"⚠️ ارسال متن کامل به گروه کامنت ناموفق بود:\n{last_err}\n\n" + _hint_for(last_err),
            )
    except Exception:
        pass
    return False


def render_footer_html(footer: str) -> str:
    """
    Footer supports:
      plain text / @channel
      markdown link: [name](https://t.me/x)
      raw HTML: <a href="https://t.me/x">name</a>
    """
    s = (footer or "").strip()
    if not s:
        return ""
    # Already HTML link — keep as-is
    if re.search(r"<a\s+href=", s, re.I):
        return s

    def md_repl(m):
        label = html.escape(m.group(1).strip())
        href = html.escape(m.group(2).strip(), quote=True)
        return f'<a href="{href}">{label}</a>'

    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", md_repl, s)
    return s


def format_post_fa(
    title_fa: str,
    body_fa: str,
    source_name: str,
    url: str,
    footer: str = "",
    hashtags: list | None = None,
) -> str:
    title_fa = strip_md((title_fa or "").strip())
    body_fa = strip_md((body_fa or "").strip())
    if len(title_fa) > 200:
        body_fa = (title_fa + "\n" + body_fa).strip()
        title_fa = title_fa[:180] + "…"
    src_name = (source_name or "منبع").strip() or "منبع"
    url = (url or "").strip()
    # Clickable source label only — no raw URL, no page preview
    if url:
        src_line = f'🏷 منبع: <a href="{html.escape(url, quote=True)}">{html.escape(src_name)}</a>'
    else:
        src_line = f"🏷 منبع: {html.escape(src_name)}"
    parts = [f"📢 <b>{html.escape(title_fa)}</b>", ""]
    if body_fa:
        parts.append(html.escape(body_fa))
        parts.append("")
    parts.append(src_line)
    if hashtags:
        parts.append("")
        parts.append(" ".join(hashtags))
    footer_html = render_footer_html(footer)
    if footer_html:
        parts.append("")
        parts.append(footer_html)
    text = "\n".join(parts).strip()
    return text[:MAX_TG_MESSAGE]


def draft_keyboard(draft_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup()
    kb.row(
        InlineKeyboardButton("✅ انتشار", callback_data=f"pub:{draft_id}"),
        InlineKeyboardButton("🔁 بازنویسی", callback_data=f"regen:{draft_id}"),
    )
    kb.row(
        InlineKeyboardButton("❌ رد", callback_data=f"rej:{draft_id}"),
        InlineKeyboardButton("📋 کانال", callback_data=f"menu:channel"),
    )
    return kb


def main_menu_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("📡 اسکن خبرها", callback_data="menu:scan"),
        InlineKeyboardButton("📥 صف بررسی", callback_data="menu:review"),
    )
    kb.add(
        InlineKeyboardButton("⚙️ تنظیمات", callback_data="menu:settings"),
        InlineKeyboardButton("🗑 حذف از کانال", callback_data="menu:delete"),
    )
    kb.add(InlineKeyboardButton("🗞 مرور خبری دوره‌ای", callback_data="menu:digest"))
    return kb


def settings_keyboard(user: dict) -> InlineKeyboardMarkup:
    uid = user.get("telegram_id", 0)
    auto = bool(user.get("auto_publish"))
    auto_label = "🟢 ارسال اتومات: روشن" if auto else "⚪️ ارسال اتومات: خاموش"
    provider = ((user or {}).get("ai_provider") or AI_PROVIDER or AI_CHAIN[0]).strip().lower()
    if provider not in PROVIDERS:
        provider = AI_CHAIN[0]
    model = user.get("ai_model") or PROVIDERS[provider]["model"]
    filter_count = len(load_user_filters(uid))
    kb = InlineKeyboardMarkup(row_width=1)
    kb.add(InlineKeyboardButton(auto_label, callback_data="set:toggle_auto"))
    dig_on = digest_enabled(user)
    dig_h = digest_interval_hours(user)
    kb.add(InlineKeyboardButton(
        ("🟢 " if dig_on else "⚪️ ") + f"🗞 مرور: {'روشن' if dig_on else 'خاموش'} · هر {dig_h} ساعت",
        callback_data="set:toggle_digest",
    ))
    ch_info = (user.get("channel_username") or str(user.get("channel_id")) or "—")
    kb.add(InlineKeyboardButton(f"📺 کانال: {ch_info[:25]}", callback_data="menu:channel"))
    disc_info = (user.get("discussion_username") or str(user.get("discussion_chat_id")) or "—")
    kb.add(InlineKeyboardButton(f"💬 گروه: {disc_info[:25]}", callback_data="menu:discussion"))
    kb.add(InlineKeyboardButton(f"🤖 هوش مصنوعی: {PROVIDERS[provider]['label']} · {model[:28]}", callback_data="menu:ai"))
    kb.add(InlineKeyboardButton(f"🎯 فیلترها ({filter_count})", callback_data="menu:filters"))
    kb.add(InlineKeyboardButton("📡 منابع", callback_data="menu:sources"))
    footer_short = (user.get("channel_footer") or DEFAULT_CHANNEL_FOOTER or "—")[:20]
    kb.add(InlineKeyboardButton(f"✍️ فوتر: {footer_short}", callback_data="menu:footer"))
    kb.add(InlineKeyboardButton("💰 موجودی کلیدها", callback_data="menu:balance"))
    if BOT_ACTIVE:
        kb.add(InlineKeyboardButton("✅ ربات فعال", callback_data="set:bot_off"))
    else:
        kb.add(InlineKeyboardButton("⚪️ ربات خاموش", callback_data="set:bot_on"))
    return kb


def digest_keyboard(user: dict) -> InlineKeyboardMarkup:
    h = digest_interval_hours(user)
    on = digest_enabled(user)
    kb = InlineKeyboardMarkup(row_width=3)
    kb.row(
        InlineKeyboardButton("🟢 روشن", callback_data="set:digest:on"),
        InlineKeyboardButton("⚪️ خاموش", callback_data="set:digest:off"),
        InlineKeyboardButton("📤 همین حالا", callback_data="set:digest:now"),
    )
    kb.row(
        InlineKeyboardButton("6h", callback_data="set:digest:h6"),
        InlineKeyboardButton("8h", callback_data="set:digest:h8"),
        InlineKeyboardButton("12h", callback_data="set:digest:h12"),
    )
    kb.row(
        InlineKeyboardButton("18h", callback_data="set:digest:h18"),
        InlineKeyboardButton("24h", callback_data="set:digest:h24"),
        InlineKeyboardButton("⬅️ تنظیمات", callback_data="menu:settings"),
    )
    return kb


def ai_menu_keyboard(user: dict) -> InlineKeyboardMarkup:
    provider = ((user or {}).get("ai_provider") or AI_PROVIDER or "").strip().lower()
    if provider not in PROVIDERS:
        provider = AI_CHAIN[0]
    kb = InlineKeyboardMarkup(row_width=1)
    for p in AI_CHAIN:
        prov = PROVIDERS[p]
        mark = "✅ " if p == provider else ""
        tail = "" if prov["key"] else "  (کلید ندارد)"
        kb.add(InlineKeyboardButton(f"{mark}{prov['label']}{tail}", callback_data=f"set:ai:{p}"))
    # models of selected provider
    seen = []
    for mid in [PROVIDERS[provider]["model"]] + list(PROVIDERS[provider]["models"]):
        if mid and mid not in seen and PROVIDERS[provider]["key"]:
            seen.append(mid)
    current = (user or {}).get("ai_model") or PROVIDERS[provider]["model"]
    for mid in seen:
        h = _health_get(provider, mid)
        badge = {"ok": " 🟢", "busy": " ⏳", "dead": " ❌", "transient": " ⚠️"}.get(h.get("status"), "")
        mark = "✅ " if mid == current else ""
        short = mid.split("/")[-1] if "/" in mid else mid
        kb.add(InlineKeyboardButton(f"{mark}{short}{badge}", callback_data=f"set:model:{mid[:80]}"))
    kb.add(InlineKeyboardButton("🧪 تست هوش مصنوعی", callback_data="menu:testai"))
    kb.add(InlineKeyboardButton("🔎 بررسی همهٔ ارائه‌دهنده‌ها", callback_data="menu:aicheck"))
    kb.add(InlineKeyboardButton("💰 باقی‌ماندهٔ کلیدها", callback_data="menu:balance"))
    return kb


# ============================================================
# Channel binding & publish / delete
# ============================================================

def require_channel(user: dict):
    if not user or not user.get("channel_id"):
        return None
    return int(user["channel_id"])


def get_article_images(article: dict) -> list:
    imgs = article.get("images") if isinstance(article, dict) else None
    if not imgs:
        return []
    if isinstance(imgs, str):
        try:
            imgs = json.loads(imgs)
        except Exception:
            imgs = []
    out = []
    for u in imgs or []:
        u = (u or "").strip()
        if u.startswith("http") and u not in out:
            out.append(u)
    return out[:MAX_POST_IMAGES]


def publish_draft(user: dict, draft: dict, text: str, article: dict | None = None) -> tuple[bool, str]:
    chat_id = require_channel(user)
    if not chat_id:
        return False, "ابتدا کانال را متصل کنید (/channel)."
    images = get_article_images(article or {})
    try:
        msg_id = None
        if images:
            caption = text if len(text) <= 1024 else text[:1000] + "…"
            media = [InputMediaPhoto(images[0], caption=caption, parse_mode=PARSE_MODE)]
            for u in images[1:]:
                media.append(InputMediaPhoto(u))
            try:
                msgs = bot.send_media_group(chat_id, media)
                if msgs:
                    msg_id = msgs[0].message_id
            except Exception as e:
                log.warning("media group failed (%s) — text only", e)
                msg = bot.send_message(
                    chat_id, text, parse_mode=PARSE_MODE,
                    disable_web_page_preview=True,
                )
                msg_id = msg.message_id
        else:
            msg = bot.send_message(
                chat_id, text, parse_mode=PARSE_MODE, disable_web_page_preview=True,
            )
            msg_id = msg.message_id

        sb_patch(
            f"drafts?id=eq.{draft['id']}",
            {
                "status": "published",
                "fa_text": text,
                "published_message_id": msg_id,
                "published_at": utcnow_iso(),
                "updated_at": utcnow_iso(),
                "error": None,
            },
        )
        return True, str(msg_id or "")
    except Exception as e:
        sb_patch(
            f"drafts?id=eq.{draft['id']}",
            {"status": "failed", "error": str(e)[:500], "updated_at": utcnow_iso()},
        )
        return False, str(e)


def delete_from_channel(user: dict, draft: dict) -> tuple[bool, str]:
    chat_id = require_channel(user)
    msg_id = draft.get("published_message_id")
    if not chat_id or not msg_id:
        return False, "پیامی برای حذف یافت نشد."
    try:
        bot.delete_message(chat_id, int(msg_id))
        sb_patch(
            f"drafts?id=eq.{draft['id']}",
            {"status": "rejected", "updated_at": utcnow_iso()},
        )
        return True, "حذف شد"
    except Exception as e:
        return False, str(e)


def send_review_card(user_id: int, draft: dict, article: dict):
    text = draft.get("fa_text") or article.get("title") or ""
    header = (
        f"🔎 پیش‌نویس #{draft['id']}\n"
        f"منبع: {article.get('source_name') or '—'} | دسته: {article.get('category') or '—'}\n"
        f"وضعیت اتومات: {'روشن' if (get_user(user_id) or {}).get('auto_publish') else 'خاموش'}\n"
        f"{'—'*24}\n"
    )
    body = (header + text)[:MAX_TG_MESSAGE]
    try:
        bot.send_message(user_id, body, reply_markup=draft_keyboard(draft["id"]))
    except Exception as e:
        log.warning("send_review_card %s: %s", user_id, e)


# ============================================================
# Scan pipeline
# ============================================================

def parse_feed_items(url: str) -> list:
    try:
        feed = feedparser.parse(url)
        return list(feed.entries or [])[:MAX_FEED_ITEMS]
    except Exception as e:
        log.warning("feed %s: %s", url, e)
        return []


def upsert_draft(user_id: int, article_id: int, fa_text: str, full_text: str, status: str):
    """Insert or update a draft (unique user_id+article_id)."""
    existing = find_draft(user_id, article_id)
    if existing:
        fields = {"fa_text": fa_text, "status": status, "updated_at": utcnow_iso(), "error": None}
        if full_text:
            fields["full_text"] = full_text
        try:
            rows = sb_patch(f"drafts?id=eq.{existing['id']}", fields)
            return (rows[0] if rows else None) or find_draft(user_id, article_id)
        except Exception as e:
            log.warning("upsert draft patch: %s", e)
            try:
                rows = sb_patch(
                    f"drafts?id=eq.{existing['id']}",
                    {"fa_text": fa_text, "status": status, "updated_at": utcnow_iso()},
                )
                return (rows[0] if rows else None) or find_draft(user_id, article_id)
            except Exception:
                return existing
    payload = [{
        "user_id": user_id,
        "article_id": article_id,
        "fa_text": fa_text,
        "status": status,
    }]
    try:
        payload[0]["full_text"] = full_text or ""
        rows = sb_post("drafts", payload)
        return rows[0] if rows else find_draft(user_id, article_id)
    except Exception:
        try:
            payload[0].pop("full_text", None)
            rows = sb_post("drafts", payload)
            d = rows[0] if rows else find_draft(user_id, article_id)
            if d and full_text:
                try:
                    sb_patch(f"drafts?id=eq.{d['id']}", {"full_text": full_text})
                    d["full_text"] = full_text
                except Exception:
                    pass
            return d
        except Exception as e:
            log.warning("draft insert: %s", e)
            return find_draft(user_id, article_id)


def check_feed(url: str) -> tuple[int, int, str]:
    """Return (http_status, item_count, first_title)."""
    try:
        r = httpx.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            },
            timeout=20.0,
            follow_redirects=True,
        )
        body = r.text or ""
        items = len(re.findall(r"<item[\s>]", body, re.I)) + len(re.findall(r"<entry[\s>]", body, re.I))
        m = re.search(r"<title>(?:<!\[CDATA\[)?([^<\]]{5,80})", body)
        return r.status_code, items, (m.group(1).strip()[:40] if m else "")
    except Exception as e:
        return 0, 0, str(e)[:80]


# ============================================================
# Article filters (block keywords, categories, sources)
# ============================================================

def load_user_filters(user_id: int) -> list[dict]:
    """Load active filters for a user."""
    try:
        return sb_get(f"article_filters?user_id=eq.{user_id}&enabled=eq.true&limit=200")
    except Exception as e:
        # table not created yet
        log.debug("load_user_filters: %s", e)
        return []


def article_passes_filters(article: dict, filters: list[dict], source_row: dict) -> bool:
    """
    Check if an article should be processed based on user filters.
    Returns False if the article should be BLOCKED.
    """
    if not filters:
        return True

    title = (article.get("title") or "").lower()
    summary = (article.get("summary") or "").lower()
    source_name = (source_row.get("name") or article.get("source_name") or "").lower()
    category = (article.get("category") or source_row.get("category") or "").lower()
    full_text = f" {title} {summary} "

    has_only = False  # if any only_keyword exists, article must match at least one

    for f in filters:
        ftype = (f.get("filter_type") or "").strip().lower()
        fval = (f.get("match_value") or "").strip().lower()
        if not fval:
            continue

        if ftype == "block_keyword":
            if fval in full_text:
                return False
        elif ftype == "block_category":
            if fval == category:
                return False
        elif ftype == "block_source":
            if fval == source_name:
                return False
        elif ftype == "only_keyword":
            has_only = True
            if fval not in full_text:
                # will be checked after loop — article must match at least one
                continue

    if has_only:
        # At least one only_keyword filter existed — article must match at least one
        matched = False
        for f in filters:
            if (f.get("filter_type") or "").strip().lower() == "only_keyword":
                fval = (f.get("match_value") or "").strip().lower()
                if fval and fval in full_text:
                    matched = True
                    break
        if not matched:
            return False

    return True


def process_user_scan(user_id: int):
    user = get_user(user_id)
    if not user or not user.get("channel_id"):
        return
    try:
        sources = sb_get(
            f"sources?user_id=eq.{user_id}&enabled=eq.true&order=id.asc&limit=50"
        )
    except Exception as e:
        log.error("load sources user %s: %s", user_id, e)
        return
    if not sources:
        return

    # Rotate / shuffle so we do not only drain the first feed (BBC)
    sources = list(sources)
    random.shuffle(sources)
    # Interleave: take from many sources, few items each
    auto = bool(user.get("auto_publish"))
    created = 0
    published = 0
    per_source = {}

    # Load user filters once per scan
    filters = load_user_filters(user_id)

    for src in sources:
        if created >= MAX_ITEMS_PER_SCAN:
            break
        src_type = (src.get("source_type") or "rss").lower()
        try:
            if src_type == "rss":
                items = parse_feed_items(src["url"])
            elif src_type in ("twitter", "instagram"):
                # Social media scraping is not yet implemented.
                # Users can add these via /addsite for future integration.
                log.warning("social source %s (%s) — scraping not implemented yet", src.get("name"), src_type)
                continue
            else:
                log.warning("unknown source type %s for %s", src_type, src.get("name"))
                continue
        except Exception as e:
            log.warning("feed %s: %s", src.get("url"), e)
            continue
        src_key = src.get("id") or src.get("url")
        for item in items:
            if created >= MAX_ITEMS_PER_SCAN:
                break
            if per_source.get(src_key, 0) >= MAX_NEW_PER_SOURCE:
                break
            article = ensure_article(src, item)
            if not article:
                continue
            # Apply user filters BEFORE processing (saves AI credits)
            if not article_passes_filters(article, filters, src):
                log.debug("article filtered out user=%s source=%s title=%s", user_id, src.get("name"), article.get("title")[:50])
                continue
            draft = find_draft(user_id, article["id"])
            if draft:
                # Only terminal/active states block reprocessing.
                # failed drafts are retried when AI recovers.
                if draft.get("status") in ("published", "pending", "waiting_review", "rejected"):
                    continue

            src_lang = (article.get("source_lang") or src.get("lang") or "en").lower()
            fa, used_ai = ai_persian_post(
                title=article.get("title") or "",
                summary=article.get("summary") or "",
                source_name=article.get("source_name") or src.get("name") or "",
                source_lang=article.get("source_lang") or src.get("lang") or "en",
                url=article.get("url") or "",
                user=user,
                category=article.get("category") or src.get("category") or "",
            )
            if not used_ai:
                provider, _b, _k, model = resolve_ai(user)
                h = _health_get(provider, model)
                log.warning(
                    "draft user=%s FALLBACK (AI failed) source=%s lang=%s head=%s model=%s",
                    user_id, src.get("name"), src_lang, provider, model,
                )
                notify_ai_failure(
                    user_id,
                    f"منبع: {src.get('name')}\n"
                    f"آخرین تلاش: {PROVIDERS.get(provider, {}).get('label', provider)} · {model}\n"
                    f"وضعیت: {h.get('status')} · {str(h.get('err') or 'AI chain failed')[:160]}",
                )
                # Do not auto-publish raw English when translation is down
                if SKIP_EN_WHEN_AI_FAILS and not src_lang.startswith("fa") and auto:
                    log.info("skip EN publish user=%s source=%s (AI fail)", user_id, src.get("name"))
                    upsert_draft(user_id, article["id"], fa, "", "failed")
                    per_source[src_key] = per_source.get(src_key, 0) + 1
                    continue

            full_fa = ""
            if require_channel(user):
                full_fa, _ = ai_full_persian(
                    title=article.get("title") or "",
                    summary=article.get("summary") or "",
                    source_name=article.get("source_name") or src.get("name") or "",
                    source_lang=article.get("source_lang") or src.get("lang") or "en",
                    url=article.get("url") or "",
                    user=user,
                    short_post=fa,
                )

            draft = upsert_draft(user_id, article["id"], fa, full_fa, "pending")
            if not draft:
                continue

            created += 1
            per_source[src_key] = per_source.get(src_key, 0) + 1

            if auto:
                t0 = time.time()
                ok, info = publish_draft(user, draft, fa, article)
                if ok:
                    published += 1
                    # publish FIRST, then comment on the mirrored post
                    discussion_publish(user, draft, full_fa or fa, info, since_ts=t0)
                else:
                    send_review_card(user_id, draft, article)
            else:
                try:
                    sb_patch(
                        f"drafts?id=eq.{draft['id']}",
                        {"status": "waiting_review", "updated_at": utcnow_iso()},
                    )
                except Exception:
                    pass
                draft = find_draft(user_id, draft["id"]) or draft
                send_review_card(user_id, draft, article)
            time.sleep(0.15)

    if created and not auto:
        try:
            bot.send_message(
                user_id,
                f"📨 {created} پیش‌نویس جدید (چند منبع) آماده بررسی. /review",
            )
        except Exception:
            pass
    if auto and published:
        log.info("user %s auto-published %s posts this scan", user_id, published)
    if created:
        log.info("user %s scan: created=%s sources_touched=%s", user_id, created, len(per_source))


def scan_all_users():
    try:
        users = sb_get("bot_users?channel_id=not.is.null&limit=500")
    except Exception as e:
        log.error("scan_all_users list: %s", e)
        return
    for u in users:
        try:
            process_user_scan(int(u["telegram_id"]))
            time.sleep(0.4)
        except Exception as e:
            log.error("scan user %s: %s", u.get("telegram_id"), e)


def scanner_loop():
    global LAST_CLEANUP_TS
    log.info("scanner loop every %ss (digest check each tick)", SCAN_INTERVAL_SEC)
    tick = 0
    while True:
        try:
            if tick % 10 == 0:  # refresh key pool from Supabase every ~10 scans
                reload_dynamic_keys()
        except Exception as e:
            log.error("reload keys: %s", e)
        if not BOT_ACTIVE:
            log.info("Bot inactive (BOT_ACTIVE=false) — skipping scan and digests")
            # Still run cleanup occasionally, but skip AI/scan/digest
            if time.time() - LAST_CLEANUP_TS >= CLEANUP_INTERVAL_SEC:
                try:
                    cleanup_old_rows()
                    LAST_CLEANUP_TS = time.time()
                except Exception as e:
                    log.error("cleanup_loop: %s", e)
            time.sleep(SCAN_INTERVAL_SEC)
            tick += 1
            continue
        try:
            scan_all_users()
        except Exception as e:
            log.error("scanner_loop: %s", e)
        try:
            maybe_recover_all_down()
        except Exception as e:
            log.error("ai_recover: %s", e)
        try:
            check_all_digests()
        except Exception as e:
            log.error("digest_loop: %s", e)
        try:
            if time.time() - LAST_CLEANUP_TS >= CLEANUP_INTERVAL_SEC:
                cleanup_old_rows()
                LAST_CLEANUP_TS = time.time()
        except Exception as e:
            log.error("cleanup_loop: %s", e)
        tick += 1
        time.sleep(SCAN_INTERVAL_SEC)


# ============================================================
# Digest (periodic round-up of published channel news)
# ============================================================

def channel_post_link(user: dict, message_id) -> str:
    """t.me link to a published channel post (public @name or private c/<id>)."""
    uname = (user.get("channel_username") or "").strip().lstrip("@")
    mid = int(message_id)
    if uname:
        return f"https://t.me/{uname}/{mid}"
    cid = str(user.get("channel_id") or "")
    if cid.startswith("-100"):
        cid = cid[4:]
    elif cid.startswith("-"):
        cid = cid[1:]
    return f"https://t.me/c/{cid}/{mid}" if cid else ""


def extract_fa_title(fa_text: str) -> str:
    """Plain headline from stored HTML post: 📢 <b>Title</b> …"""
    if not fa_text:
        return ""
    first = fa_text.strip().splitlines()[0]
    first = re.sub(r"<[^>]+>", "", first)
    first = first.replace("📢", "").strip()
    first = re.sub(r"\s+", " ", first)
    return first[:200]


def digest_interval_hours(user: dict) -> int:
    try:
        n = int(user.get("digest_interval_hours") or DIGEST_INTERVAL_HOURS)
    except Exception:
        n = DIGEST_INTERVAL_HOURS
    return max(1, min(168, n))


def digest_enabled(user: dict) -> bool:
    v = user.get("digest_enabled")
    if v is None:
        return DIGEST_ENABLED_DEFAULT
    return bool(v)


def build_digest_text(user: dict, drafts: list, hours: int) -> str:
    items = []
    for d in drafts:
        title = extract_fa_title(d.get("fa_text") or "")
        mid = d.get("published_message_id")
        if not title or not mid:
            continue
        link = channel_post_link(user, mid)
        if not link:
            continue
        label = html.escape(title)
        items.append(f'• <a href="{html.escape(link, quote=True)}">{label}</a>')
        if len(items) >= DIGEST_MAX_ITEMS:
            break
    if not items:
        return ""
    body = "\n".join(items)
    foot = ""
    footer = (user.get("channel_footer") or DEFAULT_CHANNEL_FOOTER or "").strip()
    if footer and not re.search(r"<a\s+href=", footer, re.I):
        foot = f"\n\n{html.escape(footer)}"
    elif footer:
        foot = f"\n\n{footer}"
    # bold header via HTML for parse_mode; #مرور at first and last line
    text = f"#مرور\n\n🗞 <b>مرور {hours} ساعت اخیر</b>\n\n{body}{foot}\n\n#مرور"
    return text[:MAX_TG_MESSAGE]


def publish_digest_for_user(user: dict, force: bool = False):
    """Create + post the round-up. Returns (ok, detail)."""
    uid = user.get("telegram_id")
    chat = require_channel(user)
    if not chat:
        return False, "کانال متصل نیست"
    hours = digest_interval_hours(user)
    if not force and not digest_enabled(user):
        return False, "غیرفعال"
    window_start = None
    last = user.get("digest_last_at")
    if last:
        window_start = str(last).replace(" ", "T")
    else:
        from datetime import timedelta
        window_start = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    if force:
        # last N hours from now
        from datetime import timedelta
        window_start = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    q = (
        f"drafts?user_id=eq.{uid}&status=eq.published"
        f"&published_at=gte.{window_start}"
        f"&order=published_at.desc&limit={DIGEST_MAX_ITEMS + 5}"
    )
    try:
        drafts = sb_get(q)
    except Exception as e:
        log.error("digest query failed user=%s: %s", uid, e)
        return False, str(e)
    if not drafts:
        return False, "خبر جدیدی در بازه نبود"
    text = build_digest_text(user, drafts, hours)
    if not text:
        return False, "آیتم قابل نمایشی نبود"
    try:
        msg = bot.send_message(chat, text, parse_mode=PARSE_MODE, disable_web_page_preview=True)
    except Exception as e:
        log.error("digest send failed user=%s: %s", uid, e)
        return False, str(e)
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{uid}",
            {"digest_last_at": utcnow_iso(), "updated_at": utcnow_iso()},
        )
    except Exception as e:
        log.warning("digest_last_at patch failed (run sql/04): %s", e)
    log.info("digest posted user=%s items=%d msg=%s", uid, min(len(drafts), DIGEST_MAX_ITEMS), msg.message_id)
    return True, f"{min(len(drafts), DIGEST_MAX_ITEMS)} خبر"


def check_all_digests():
    try:
        users = sb_get("bot_users?channel_id=not.is.null&limit=500")
    except Exception as e:
        log.error("check_all_digests list: %s", e)
        return
    now = datetime.now(timezone.utc)
    for u in users:
        try:
            if not digest_enabled(u):
                continue
            last = u.get("digest_last_at")
            hours = digest_interval_hours(u)
            if last:
                try:
                    last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    last_dt = None
                if last_dt and (now - last_dt).total_seconds() < hours * 3600:
                    continue
            ok, detail = publish_digest_for_user(u, force=False)
            if ok:
                log.info("digest due user=%s → %s", u.get("telegram_id"), detail)
        except Exception as e:
            log.error("digest user=%s: %s", u.get("telegram_id"), e)


def cleanup_old_rows(force: bool = False) -> tuple[int, int]:
    """
    Housekeeping: rows already handled (published/rejected/failed) older than
    RETENTION_DAYS are deleted — the content is in Telegram already.
    Unhandled drafts (pending / waiting_review) are always kept.
    Orphan articles (no remaining draft references them) are deleted too.
    Returns (drafts_deleted, articles_deleted).
    """
    days = max(1, RETENTION_DAYS)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    d_del = a_del = 0
    # 1) delete terminal drafts older than cutoff
    try:
        d_del = sb_delete(
            f"drafts?status=in.(published,rejected,failed)&updated_at=lt.{cutoff}"
        ) or 0
    except Exception as e:
        log.error("cleanup drafts: %s", e)
    # 2) article ids still referenced by remaining drafts
    keep: set[int] = set()
    try:
        rows = sb_get("drafts?select=article_id&article_id=not.is.null&limit=10000")
        for r in rows:
            try:
                keep.add(int(r["article_id"]))
            except Exception:
                pass
    except Exception as e:
        log.error("cleanup list drafts: %s", e)
    # 3) delete articles not referenced by any remaining draft (orphan cleanup)
    # NOTE: do NOT filter by created_at — an old article row may still be referenced
    # by a freshly pending draft; only orphans are safe to delete.
    try:
        if keep:
            ids = ",".join(str(i) for i in sorted(keep))
            a_del = sb_delete(f"articles?id=not.in.({ids})") or 0
        # if keep is empty, leave articles untouched (no drafts at all)
    except Exception as e:
        log.error("cleanup articles: %s", e)
    if d_del or a_del or force:
        log.info("cleanup: %d drafts + %d articles older than %dd", d_del, a_del, days)
    return d_del, a_del


# ============================================================
# Bot commands
# ============================================================

@bot.message_handler(commands=["start", "help"])
def cmd_start(message):
    user = upsert_user(message)
    auto = "روشن 🟢" if user.get("auto_publish") else "خاموش ⚪️"
    ch = user.get("channel_username") or (
        str(user["channel_id"]) if user.get("channel_id") else "—"
    )
    bot.send_message(
        message.chat.id,
        (
            f"ربات ادمین کانال خبری — نسخه {BOT_VERSION}\n\n"
            f"👤 {message.from_user.first_name or ''}\n"
            f"📺 کانال متصل: {ch}\n"
            f"⚙️ ارسال اتومات: {auto}\n\n"
            "دستورها:\n"
            "/channel — اتصال کانال (بات را ادمین کنید)\n"
            "/auto on|off — روشن/خاموش کردن ارسال اتومات\n"
            "/scan — اسکن فوری منابع\n"
            "/review — پیش‌نویس‌های در انتظار بررسی\n"
            "/published — پست‌های منتشرشده (برای حذف)\n"
            "/digest — مرور خبری هر ۱۲ ساعت (on|off|now|6|12|24)\n"
            "/sources — فهرست منابع خبری\n"
            "/addsource <name> | <rss_url> | <category>\n"
            "/settings — تنظیمات\n"
            "/help — راهنما\n\n"
            "وقتی «اتومات» روشن است، خبرهای جدید پس از ترجمه/خلاصه فارسی "
            "مستقیم در کانال منتشر می‌شوند.\n"
            "وقتی خاموش است، پیش‌نویس‌ها برای شما می‌آیند و با دکمه تأیید می‌کنید."
        ),
        reply_markup=main_menu_keyboard(),
    )


@bot.message_handler(commands=["channel"])
def cmd_channel(message):
    upsert_user(message)
    awaiting_channel.add(message.from_user.id)
    bot.send_message(
        message.chat.id,
        (
            "📺 اتصال کانال:\n\n"
            "1) ربات را به کانال اضافه کنید و دسترسی ادمین با اجازه «حذف پیام» بدهید.\n"
            "2) سپس یکی از این‌ها را بفرستید:\n"
            "   • یوزرنیم کانال: @mychannel\n"
            "   • یا یک پست از کانال را همین‌جا فوروارد کنید.\n\n"
            "برای لغو: /cancel"
        ),
        reply_markup=ForceReply(selective=False),
    )


@bot.message_handler(commands=["cancel"])
def cmd_cancel(message):
    awaiting_channel.discard(message.from_user.id)
    bot.send_message(message.chat.id, "لغو شد.")


@bot.message_handler(commands=["auto"])
def cmd_auto(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    if len(parts) < 2 or parts[1].lower() not in ("on", "off", "1", "0", "true", "false"):
        cur = bool(user.get("auto_publish"))
        bot.send_message(
            message.chat.id,
            f"وضعیت فعلی ارسال اتومات: {'روشن' if cur else 'خاموش'}\n"
            f"فرمت: /auto on  یا  /auto off",
        )
        return
    flag = parts[1].lower() in ("on", "1", "true")
    sb_patch(
        f"bot_users?telegram_id=eq.{message.from_user.id}",
        {"auto_publish": flag, "updated_at": utcnow_iso()},
    )
    bot.send_message(
        message.chat.id,
        "🟢 ارسال اتومات روشن شد. خبرهای جدید مستقیم در کانال منتشر می‌شوند."
        if flag
        else "⚪️ ارسال اتومات خاموش شد. پیش‌نویس‌ها برای بررسی دستی می‌آیند.",
    )


@bot.message_handler(commands=["scan"])
def cmd_scan(message):
    user = upsert_user(message)
    if not require_channel(user):
        bot.send_message(message.chat.id, "ابتدا /channel را کامل کنید.")
        return
    bot.send_message(message.chat.id, "⏳ در حال اسکن منابع…")
    threading.Thread(target=lambda: _scan_and_notify(message.from_user.id), daemon=True).start()


def _scan_and_notify(user_id: int):
    try:
        process_user_scan(user_id)
        bot.send_message(user_id, "✅ اسکن تمام شد. /review")
    except Exception as e:
        try:
            bot.send_message(user_id, f"❌ خطا در اسکن: {e}")
        except Exception:
            pass


@bot.message_handler(commands=["review"])
def cmd_review(message):
    user = upsert_user(message)
    try:
        drafts = sb_get(
            f"drafts?user_id=eq.{user['telegram_id']}&status=in.(pending,waiting_review)"
            f"&order=id.desc&limit=10"
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا در دریافت صف: {e}")
        return
    if not drafts:
        bot.send_message(message.chat.id, "📭 صف بررسی خالی است. /scan")
        return
    for d in reversed(drafts):
        arts = sb_get(f"articles?id=eq.{d['article_id']}&limit=1")
        art = arts[0] if arts else {"title": "", "source_name": "—", "category": "—"}
        send_review_card(user["telegram_id"], d, art)


@bot.message_handler(commands=["published"])
def cmd_published(message):
    upsert_user(message)
    try:
        drafts = sb_get(
            f"drafts?user_id=eq.{message.from_user.id}&status=eq.published"
            f"&order=published_at.desc&limit=10"
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")
        return
    if not drafts:
        bot.send_message(message.chat.id, "هنوز پستی از طریق ربات منتشر نشده است.")
        return
    for d in drafts:
        arts = sb_get(f"articles?id=eq.{d['article_id']}&limit=1")
        art = arts[0] if arts else {"title": d.get("fa_text", "")[:80], "url": ""}
        preview = (d.get("fa_text") or art.get("title") or "")[:180]
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🗑 حذف از کانال", callback_data=f"del:{d['id']}"))
        bot.send_message(
            message.chat.id,
            f"✅ #{d['id']}\n{preview}\n\nپیام: {d.get('published_message_id')}",
            reply_markup=kb,
        )


@bot.message_handler(commands=["sources"])
def cmd_sources(message):
    user = upsert_user(message)
    try:
        rows = sb_get(f"sources?user_id=eq.{user['telegram_id']}&order=name.asc&limit=50")
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")
        return
    if not rows:
        bot.send_message(message.chat.id, "منبعی ثبت نشده. /addsource یا دوباره /start بزنید.")
        return
    lines = ["📡 منابع خبری شما:\n"]
    for r in rows:
        mark = "🟢" if r.get("enabled") else "⚪️"
        lines.append(f"{mark} #{r['id']} {r['name']} [{r.get('category')}] {r.get('lang')}")
    lines.append("\nخاموش/روشن: /togglesource <id>")
    lines.append("افزودن: /addsource نام | آدرس‌RSS | دسته")
    bot.send_message(message.chat.id, "\n".join(lines)[:MAX_TG_MESSAGE])


@bot.message_handler(commands=["addsource"])
def cmd_addsource(message):
    user = upsert_user(message)
    raw = (message.text or "").split(" ", 1)
    if len(raw) < 2:
        bot.send_message(
            message.chat.id,
            "فرمت: /addsource The Verge | https://www.theverge.com/rss/index.xml | tech",
        )
        return
    parts = [p.strip() for p in raw[1].split("|")]
    if len(parts) < 2:
        bot.send_message(message.chat.id, "حداقل نام و آدرس RSS لازم است.")
        return
    name, url = parts[0], parts[1]
    category = parts[2] if len(parts) > 2 else "world"
    lang = parts[3] if len(parts) > 3 else ("fa" if "ir" in url or "isna" in url else "en")
    try:
        sb_post("sources", [{
            "user_id": user["telegram_id"],
            "name": name[:80],
            "url": url[:500],
            "lang": lang,
            "category": category[:40],
            "enabled": True,
        }])
        bot.send_message(message.chat.id, f"✅ منبع «{name}» اضافه شد.")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا (ممکن است تکراری باشد): {e}")


@bot.message_handler(commands=["togglesource"])
def cmd_togglesource(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        bot.send_message(message.chat.id, "فرمت: /togglesource 12")
        return
    sid = int(parts[1])
    try:
        rows = sb_get(f"sources?id=eq.{sid}&user_id=eq.{user['telegram_id']}&limit=1")
        if not rows:
            bot.send_message(message.chat.id, "منبع پیدا نشد.")
            return
        new_val = not bool(rows[0].get("enabled"))
        sb_patch(f"sources?id=eq.{sid}", {"enabled": new_val})
        bot.send_message(message.chat.id, f"منبع #{sid} → {'روشن' if new_val else 'خاموش'}")
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


@bot.message_handler(commands=["sites"])
def cmd_sites(message):
    """List all enabled+disabled sources for the user (rss + social)."""
    user = upsert_user(message)
    try:
        rows = sb_get(f"sources?user_id=eq.{user['telegram_id']}&order=name.asc&limit=50")
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")
        return
    if not rows:
        bot.send_message(message.chat.id, "هیچ منبعی ثبت نشده. /addsite یا /addsource یا /start")
        return
    lines = ["📡 منابع شما:\n"]
    for r in rows:
        mark = "🟢" if r.get("enabled") else "⚪️"
        stype = r.get("source_type") or "rss"
        stype_icon = {"rss": "📡", "twitter": "🐦", "instagram": "📷", "youtube_rss": "📺"}.get(stype, "🔗")
        lines.append(
            f"{mark} {stype_icon} #{r['id']} {r.get('name')} [{r.get('category')}] ({stype})"
        )
    lines.append("\nخاموش/روشن: /togglesite <id>")
    lines.append("حذف: /removesite <id>")
    lines.append("اضافه: /addsite نام | url | category | lang | type")
    bot.send_message(message.chat.id, "\n".join(lines)[:MAX_TG_MESSAGE])


@bot.message_handler(commands=["addsite"])
def cmd_addsite(message):
    """Add a source (RSS or social) — supports | pipe-delimited format."""
    user = upsert_user(message)
    raw = (message.text or "").split(" ", 1)
    if len(raw) < 2:
        bot.send_message(
            message.chat.id,
            "فرمت: /addsite نام | لینک | دسته | زبان | نوع\n"
            "  نوع: rss | twitter | instagram | youtube_rss\n"
            "مثال RSS:\n"
            "/addsite BBC | https://feeds.bbci.co.uk/news/rss.xml | world | en | rss\n"
            "مثال توییتر:\n"
            "/addsite BBC Persia | https://twitter.com/BBC persian | world | fa | twitter",
        )
        return
    parts = [p.strip() for p in raw[1].split("|")]
    if len(parts) < 2:
        bot.send_message(message.chat.id, "حداقل نام و لینک لازم است.")
        return
    name, url = parts[0], parts[1]
    category = parts[2] if len(parts) > 2 else "world"
    lang = parts[3] if len(parts) > 3 else ("fa" if "twitter.com" in url or "instagram.com" in url else "en")
    src_type = (parts[4] if len(parts) > 4 else "rss").strip().lower()
    if src_type not in ("rss", "twitter", "instagram", "youtube_rss", "youtube"):
        src_type = "rss"
    try:
        sb_post("sources", [{
            "user_id": user["telegram_id"],
            "name": name[:80],
            "url": url[:500],
            "lang": lang,
            "category": category[:40],
            "source_type": src_type,
            "enabled": True,
        }])
        bot.send_message(message.chat.id, f"✅ منبع «{name}» ({src_type}) اضافه شد.")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا (ممکن است تکراری باشد): {e}")


@bot.message_handler(commands=["removesite"])
def cmd_removesite(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        bot.send_message(message.chat.id, "فرمت: /removesite <id>")
        return
    sid = int(parts[1])
    try:
        rows = sb_get(f"sources?id=eq.{sid}&user_id=eq.{user['telegram_id']}&limit=1")
        if not rows:
            bot.send_message(message.chat.id, "منبع پیدا نشد.")
            return
        sb_delete(f"sources?id=eq.{sid}")
        bot.send_message(message.chat.id, f"✅ منبع #{sid} «{rows[0].get('name')}» حذف شد.")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا: {e}")


@bot.message_handler(commands=["togglesite"])
def cmd_togglesite(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        bot.send_message(message.chat.id, "فرمت: /togglesite <id>")
        return
    sid = int(parts[1])
    try:
        rows = sb_get(f"sources?id=eq.{sid}&user_id=eq.{user['telegram_id']}&limit=1")
        if not rows:
            bot.send_message(message.chat.id, "منبع پیدا نشد.")
            return
        new_val = not bool(rows[0].get("enabled"))
        sb_patch(f"sources?id=eq.{sid}", {"enabled": new_val})
        bot.send_message(message.chat.id, f"✅ منبع #{sid} → {'روشن' if new_val else 'خاموش'}")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا: {e}")


@bot.message_handler(commands=["settings"])
def cmd_settings(message):
    user = upsert_user(message)
    auto = bool(user.get("auto_publish"))
    ch = user.get("channel_username") or user.get("channel_id") or "—"
    provider, _base, key, model = resolve_ai(user)
    bot.send_message(
        message.chat.id,
        (
            f"⚙️ تنظیمات\n"
            f"کانال: {ch}\n"
            f"اتومات: {'روشن' if auto else 'خاموش'}\n"
            f"هوش مصنوعی: {provider} · {model}\n"
            f"کلید AI: {'دارد ✅' if key else 'ندارد ❌'}\n"
            f"متن پایانی: {user.get('channel_footer') or DEFAULT_CHANNEL_FOOTER or '—'}\n"
            f"اسکن هر: {SCAN_INTERVAL_SEC} ثانیه"
        ),
        reply_markup=settings_keyboard(user),
    )


def sb_patch_user_ai(user_id: int, fields: dict):
    payload = {**fields, "updated_at": utcnow_iso()}
    try:
        sb_patch(f"bot_users?telegram_id=eq.{user_id}", payload)
    except Exception as e:
        # Drop keys that may not exist until sql/02 is applied
        log.warning("sb_patch_user_ai: %s", e)
        try:
            fallback = {k: v for k, v in payload.items() if k in ("updated_at", "username")}
            if fallback:
                sb_patch(f"bot_users?telegram_id=eq.{user_id}", fallback)
        except Exception:
            pass


@bot.message_handler(commands=["ai"])
def cmd_ai(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    provider, _b, key, model = resolve_ai(user)
    if len(parts) < 2:
        try:
            bot.send_message(
                message.chat.id,
                f"هوش مصنوعی فعلی: {PROVIDERS.get(provider, {}).get('label', provider)} · {model}\n"
                f"کلید: {'دارد' if key else 'ندارد'}\n"
                f"زنجیرهٔ fallback: {' → '.join(AI_CHAIN)}\n\n"
                "فرمت: /ai xkiro | /ai inception | /ai vyce | /ai dahl | /ai deepseek\n"
                "مدل: /model <model-id>\n"
                "بررسی همه: /aicheck · موجودی: /balance",
                reply_markup=ai_menu_keyboard(user),
            )
        except Exception as e:
            log.error("cmd_ai help: %s", e)
        return
    p = parts[1].lower()
    if p not in PROVIDERS:
        bot.send_message(message.chat.id, "provider: " + " | ".join(PROVIDERS.keys()))
        return
    if not PROVIDERS[p]["key"]:
        bot.send_message(
            message.chat.id,
            f"کلید {PROVIDERS[p]['label']} در Deployka ست نشده است.",
        )
        return
    default_model = PROVIDERS[p]["model"]
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{message.from_user.id}",
            {"ai_provider": p, "ai_model": default_model, "updated_at": utcnow_iso()},
        )
        bot.send_message(message.chat.id, f"✅ هوش مصنوعی → {PROVIDERS[p]['label']} · {default_model}\n(بقیه زنجیره به‌عنوان fallback می‌مانند)")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا در تنظیم AI: {e}")


@bot.message_handler(commands=["model"])
def cmd_model(message):
    user = upsert_user(message)
    parts = (message.text or "").split(maxsplit=1)
    provider = (user.get("ai_provider") or AI_PROVIDER or AI_CHAIN[0]).strip().lower()
    if provider not in PROVIDERS:
        provider = AI_CHAIN[0]
    if len(parts) < 2:
        seen = []
        for mid in [PROVIDERS[provider]["model"]] + list(PROVIDERS[provider]["models"]):
            if mid and mid not in seen:
                seen.append(mid)
        lines = [f"ارائه‌دهنده: {PROVIDERS[provider]['label']}",
                 f"مدل فعلی: {user.get('ai_model') or PROVIDERS[provider]['model']}", ""]
        for mid in seen:
            h = _health_get(provider, mid)
            lines.append(f"• {mid}  [{h.get('status')}]")
        lines.append("\nفرمت: /model <model-id>")
        bot.send_message(message.chat.id, "\n".join(lines), reply_markup=ai_menu_keyboard(user))
        return
    model = parts[1].strip()
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{message.from_user.id}",
            {"ai_model": model[:120], "updated_at": utcnow_iso()},
        )
        bot.send_message(message.chat.id, f"✅ مدل → {model}")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ {e}")


# ============================================================
# Balance / remaining quota per provider
# ============================================================

def _fmt_num(n) -> str:
    try:
        n = float(n)
    except Exception:
        return str(n)
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return f"{n:.0f}" if n == int(n) else f"{n:.2f}"


def _pick_balance(data) -> str:
    """Best-effort extract of remaining credits/tokens from a usage JSON."""
    if not isinstance(data, (dict, list)):
        return str(data)[:120]
    keys_pref = (
        "balance", "remaining", "remaining_tokens", "remaining_credits", "credits",
        "tokens_left", "left", "free_tokens_remaining", "allowance_remaining",
        "wallet_balance", "quota_remaining", "remaining_quota", "available",
        "free_tokens", "tokens", "used", "usage", "spend",
    )
    if isinstance(data, dict):
        low = {str(k).lower(): v for k, v in data.items()}
        for k in keys_pref:
            if k in low and low[k] not in (None, "", {}, []):
                v = low[k]
                if isinstance(v, (int, float)):
                    return f"{k}={_fmt_num(v)}"
                if isinstance(v, dict):
                    inner = _pick_balance(v)
                    if inner:
                        return f"{k}: {inner}"
                return f"{k}={str(v)[:60]}"
        return json.dumps(data, ensure_ascii=False)[:160]
    return json.dumps(data, ensure_ascii=False)[:160]


def provider_balance(p: str, api_key: str | None = None) -> str:
    prov = PROVIDERS[p]
    api_key = api_key or prov.get("key")
    if not api_key:
        return "⚪️ کلید ندارد"
    paths = []
    if prov.get("balance"):
        paths.append(prov["balance"])
    paths += ["/usage", "/balance", "/subscription", "/dashboard/billing/subscription", "/credits"]
    seen_paths = []
    last_err = ""
    for path in paths:
        if path in seen_paths:
            continue
        seen_paths.append(path)
        url = f"{prov['base'].rstrip('/')}{path}" if path.startswith("/") else path
        try:
            r = httpx.get(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
                timeout=15.0,
                follow_redirects=True,
            )
            if r.status_code == 200:
                try:
                    return _pick_balance(r.json())
                except Exception:
                    # SPA / HTML page — not a JSON usage endpoint; try next path
                    continue
            if r.status_code in (404, 405):
                continue
            last_err = f"HTTP {r.status_code}"
        except Exception as e:
            last_err = str(e)[:60]
    return last_err or "endpoint موجود نیست — داشبورد را ببینید"


def _run_balance(user_id: int):
    reload_dynamic_keys()
    lines = ["💰 باقی‌ماندهٔ کلیدهای هوش مصنوعی:\n"]
    for p in AI_CHAIN:
        prov = PROVIDERS[p]
        keys = all_keys(p)
        if not keys:
            lines.append(f"⚪️ {prov['label']} — کلید ندارد")
            continue
        lines.append(f"🧩 {prov['label']} — {len(keys)} کلید:")
        for idx, key in enumerate(keys):
            kh = KEY_HEALTH.get(f"{p}::{idx}", {})
            kbadge = {"ok": "🟢", "busy": "⏳", "dead": "❌", "transient": "⚠️"}.get(kh.get("status"), "•")
            info = provider_balance(p, key)
            lines.append(f"  {kbadge} [{idx}] {mask_key(key)} → {info}")
    lines.append("\nبرخی سرویس‌ها API موجودی ندارند؛ • = بدون خطای اخیر.")
    try:
        bot.send_message(user_id, "\n".join(lines)[:3900])
    except Exception as e:
        log.error("balance send: %s", e)


@bot.message_handler(commands=["cleanup"])
def cmd_cleanup(message):
    user = upsert_user(message)
    if ADMIN_TELEGRAM_IDS and user["telegram_id"] not in ADMIN_TELEGRAM_IDS:
        bot.send_message(message.chat.id, "فقط ادمین.")
        return
    try:
        d, a = cleanup_old_rows(force=True)
        bot.send_message(
            message.chat.id,
            f"🧹 پاکسازی انجام شد:\n{d} پیش‌نویس + {a} مقاله قدیمی حذف شد.\n"
            f"(قدیمی‌تر از {RETENTION_DAYS} روز، فقط موارد منتشر/رد/ناموفق)",
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


@bot.message_handler(commands=["balance", "credits", "remaining"])
def cmd_balance(message):
    upsert_user(message)
    bot.send_message(message.chat.id, "⏳ در حال بررسی موجودی کلیدها…")
    threading.Thread(target=lambda: _run_balance(message.chat.id), daemon=True).start()


@bot.message_handler(commands=["keys", "aikeys"])
def cmd_keys(message):
    upsert_user(message)
    reload_dynamic_keys()
    lines = ["🔑 استخر کلیدهای هوش مصنوعی:\n"]
    for p in AI_CHAIN:
        prov = PROVIDERS[p]
        keys = all_keys(p)
        env_n = len(ENV_KEYS.get(p, []))
        dyn_n = len(keys) - env_n
        lines.append(f"🧩 {prov['label']} — {len(keys)} کلید (env:{env_n} + ربات:{max(0, dyn_n)})")
        if not keys:
            lines.append("   (خالی — /addkey " + p + " <key>)")
            continue
        for idx, key in enumerate(keys):
            kh = KEY_HEALTH.get(f"{p}::{idx}", {})
            kbadge = {"ok": "🟢", "busy": "⏳ busy", "dead": "❌", "transient": "⚠️"}.get(kh.get("status"), "•")
            src = "env" if idx < env_n else "db"
            lines.append(f"   {kbadge} [{idx}] {mask_key(key)} ({src})")
    lines.append("\nافزودن: /addkey <provider> <key> [برچسب]")
    lines.append("حذف: /delkey <provider> <id>")
    try:
        bot.send_message(message.chat.id, "\n".join(lines)[:3900])
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


@bot.message_handler(commands=["addkey"])
def cmd_addkey(message):
    user = upsert_user(message)
    if ADMIN_TELEGRAM_IDS and user["telegram_id"] not in ADMIN_TELEGRAM_IDS:
        bot.send_message(message.chat.id, "فقط ادمین می‌تواند کلید اضافه کند.")
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        bot.send_message(message.chat.id,
                         "فرمت: /addkey xkiro sk-... [برچسب]\n"
                         "provider: " + " | ".join(AI_CHAIN))
        return
    p = parts[1].strip().lower()
    key = parts[2].strip().split()[0] if parts[2].strip() else ""
    label = parts[2].strip()[len(key):].strip()[:60] if len(parts) > 2 else ""
    if p not in PROVIDERS or not key:
        bot.send_message(message.chat.id, "provider نامعتبر یا کلید خالی.")
        return
    if key in all_keys(p):
        bot.send_message(message.chat.id, f"این کلید از قبل در {PROVIDERS[p]['label']} هست.")
        return
    try:
        sb_post("provider_keys", [{"provider": p, "api_key": key, "label": label, "enabled": True}])
    except Exception as e:
        bot.send_message(message.chat.id,
                         f"ذخیره در دیتابیس نشد (sql/05 را اجرا کنید؟): {e}\n"
                         "کلید موقتاً در حافظه اضافه شد.")
        PROVIDERS[p]["keys"] = all_keys(p) + [key]
        _sync_primary_key(p)
        bot.send_message(message.chat.id, f"✅ {mask_key(key)} به {PROVIDERS[p]['label']} افزوده شد (موقت).")
        return
    reload_dynamic_keys()
    bot.send_message(message.chat.id, f"✅ {mask_key(key)} به {PROVIDERS[p]['label']} اضافه شد. /keys")


@bot.message_handler(commands=["delkey"])
def cmd_delkey(message):
    user = upsert_user(message)
    if ADMIN_TELEGRAM_IDS and user["telegram_id"] not in ADMIN_TELEGRAM_IDS:
        bot.send_message(message.chat.id, "فقط ادمین.")
        return
    parts = (message.text or "").split()
    if len(parts) < 3:
        bot.send_message(message.chat.id, "فرمت: /delkey <provider> <id از /keys>")
        return
    p = parts[1].strip().lower()
    if p not in PROVIDERS or not parts[2].isdigit():
        bot.send_message(message.chat.id, "provider یا id نامعتبر.")
        return
    idx = int(parts[2])
    keys = all_keys(p)
    if idx >= len(keys):
        bot.send_message(message.chat.id, "id نامعتبر.")
        return
    if idx < len(ENV_KEYS.get(p, [])):
        bot.send_message(message.chat.id, "این کلید از env است؛ در Deployka حذفش کن.")
        return
    key = keys[idx]
    try:
        sb_patch(f"provider_keys?provider=eq.{p}&api_key=eq.{key}", {"enabled": False})
    except Exception as e:
        bot.send_message(message.chat.id, f"حذف ناموفق: {e}")
        return
    reload_dynamic_keys()
    bot.send_message(message.chat.id, f"✅ {mask_key(key)} از {PROVIDERS[p]['label']} حذف شد.")


def _discussion_diag(message, user: dict):
    """Test whether the bound group really mirrors the channel post (comment target)."""
    ch = user.get("channel_id")
    gchat = user.get("discussion_chat_id")
    owner = message.chat.id
    lines = [
        "🔎 عیب‌یابی گروه کامنت\n",
        f"chat_id کانال: {ch or '—'}",
        f"@کانال: {user.get('channel_username') or '—'}",
        f"chat_id گروه: {gchat or '—'}",
        f"@گروه: {user.get('discussion_username') or '—'}",
    ]
    if not ch or not gchat:
        lines.append("\n❌ کانال یا گروه ست نشده. /channel و /discussion @group")
        bot.send_message(owner, "\n".join(lines))
        return

    last_mid = None
    try:
        rows = sb_get(
            f"drafts?user_id=eq.{user['telegram_id']}&status=eq.published"
            f"&published_message_id=not.is.null&order=published_at.desc&limit=1"
        )
        if rows:
            last_mid = int(rows[0].get("published_message_id"))
            lines.append(f"آخرین پیام منتشرشده: #{last_mid}")
    except Exception as e:
        lines.append(f"(خطای خواندن drafts: {e})")
    if not last_mid:
        lines.append("\n⚠️ پست منتشرشده‌ای با message_id ثبت‌شده نیست. اول /scan یا انتشار دستی.")
        bot.send_message(owner, "\n".join(lines))
        return

    # 1) Can the bot read the post in the CHANNEL?
    try:
        bot.forward_message(owner, int(ch), last_mid)
        lines.append("✅ پست در کانال دیده می‌شود (forward تستی برای شما ارسال شد).")
    except Exception as e:
        lines.append(f"❌ پست در کانال دیده نمی‌شود: {e}")
        bot.send_message(owner, "\n".join(lines))
        return

    # 2) Can the bot read the MIRRORED post in the discussion group?
    try:
        info = bot.get_chat(int(gchat))
        is_forum = bool(getattr(info, "is_forum", False))
        lines.append(f"نوع گروه: {'Topics/Forum روشن' if is_forum else 'گروه عادی'}")
        if is_forum:
            lines.append("⚠️ اگر کامنت در کانال نمی‌آید: گروه → Edit → Topics → **Disable** (ساده‌ترین راه).")
    except Exception as e:
        lines.append(f"(get_chat گروه: {e})")

    with MIRROR_LOCK:
        mirrors = list(MIRROR_IDS.get(int(gchat), []))[-5:]
    if mirrors:
        lines.append("آخرین mirrorهای ثبت‌شده (ts, group_id, channel_id):")
        for ts, mid_m, ch_m in mirrors:
            lines.append(f"  {time.strftime('%H:%M:%S', time.localtime(ts))} · group={mid_m} · ch={ch_m}")
    else:
        lines.append("⚠️ هنوز هیچ mirror از کانال در این گروه ثبت نشده → ربات پیام‌های گروه را دریافت نمی‌کند.")
        lines.append("   BotFather: /setprivacy → Disable، سپس ربات را Remove و دوباره Add + Admin کنید.")

    mirror_ok = False
    try:
        bot.forward_message(owner, int(gchat), last_mid)
        mirror_ok = True
        lines.append("✅ پست در گروه کامنت هم دیده می‌شود (mirror با همین message_id).")
    except Exception as e:
        lines.append(f"❌ پست در گروه کامنت دیده نمی‌شود: {e}")

    # 3) Try an actual reply comment
    try:
        bot.send_message(int(gchat), "🧪 تست کامنت (diag)", reply_to_message_id=last_mid)
        lines.append("✅ send با reply موفق شد — باید زیر پست کامنت ببینید.")
        mirror_ok = True
    except Exception as e:
        lines.append(f"⚠️ send با reply ناموفق: {e}")

    # 4) Try reply inside General topic (Groups with Topics)
    try:
        bot.send_message(
            int(gchat), "🧪 تست کامنت در General topic",
            reply_to_message_id=last_mid, message_thread_id=1,
        )
        lines.append("✅ reply با message_thread_id=1 موفق شد (گروه Topics).")
        mirror_ok = True
    except Exception as e:
        lines.append(f"ℹ️ reply با thread=1: {e}")

    if not mirror_ok:
        lines.append(
            "\n📌 نتیجه: گروهی که با /discussion بستید، **گروه بحثِ متصل به کانال نیست** "
            "یا ربات پیام‌های گروه را نمی‌بیند.\n\n"
            "۱) کانال → Manage Channel → Discussion → مطمئن شوید همین گروه لینک است\n"
            "۲) گروه را با /discussion off خاموش و دوباره /discussion @گروه_درست ببندید\n"
            "۳) در BotFather: /setprivacy → Disable\n"
            "۴) ربات را از گروه **اخراج (Remove)** کنید و دوباره دعوت و Admin کنید\n"
            "۵) یک پست جدید منتشر کنید (پست‌های قدیمی کامنت نمی‌گیرند)"
        )
    else:
        lines.append("\n✅ مسیر کامنت باز است. پست‌های جدید باید متن کامل را زیر خودشان در گروه داشته باشند.")

    bot.send_message(owner, "\n".join(lines)[:3900])


@bot.message_handler(commands=["discussion"])
def cmd_discussion(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    # Diagnostics: is the bound group really the linked discussion group?
    if len(parts) >= 2 and parts[1].lower() in ("diag", "debug", "check"):
        _discussion_diag(message, user)
        return
    # Test send full sample to bound group (prefer last published post → real comment)
    if len(parts) >= 2 and parts[1].lower() in ("test", "ping"):
        if not user.get("discussion_chat_id"):
            bot.send_message(message.chat.id, "گروه کامنت ست نشده. اول /discussion @group")
            return
        last_mid = ""
        last_draft = None
        try:
            rows = sb_get(
                f"drafts?user_id=eq.{user['telegram_id']}&status=eq.published"
                f"&published_message_id=not.is.null&order=published_at.desc&limit=1"
            )
            if rows:
                last_draft = rows[0]
                last_mid = str(last_draft.get("published_message_id") or "")
        except Exception as e:
            log.warning("discussion test lookup last post: %s", e)
        sample = (
            "🧪 تست کامنت گروه\n\n"
            "این پیام باید **زیر آخرین پست کانال** در بخش نظرات دیده شود.\n"
            f"message_id کانال: {last_mid or '—'}\n"
            "اگر در گروه معمولی افتاد ولی زیر پست نبود → گروه Topics دارد یا reply هنوز مجاز نیست."
        )
        ok = discussion_publish(user, last_draft or {"id": 0, "fa_text": "", "full_text": ""}, sample, last_mid)
        if last_mid:
            bot.send_message(
                message.chat.id,
                f"✅ تست با reply به پیام کانال #{last_mid} ارسال شد.\n"
                "کانال → سه‌نقطه پست → **نظرات** را چک کنید.",
            )
        else:
            bot.send_message(
                message.chat.id,
                "⚠️ هنوز پست منتشرشده‌ای با message_id ثبت‌شده نیست؛ پیام تست به‌صورت معمولی در گروه رفت.\n"
                "اول یک خبر منتشر کنید (/scan + auto یا /review → ✅) بعد دوباره /discussion test",
            )
        if not ok:
            bot.send_message(message.chat.id, "❌ ارسال به گروه ناموفق بود — لاگ Deployka.")
        return
    if len(parts) < 2:
        cur = user.get("discussion_chat_id") or user.get("discussion_username") or "—"
        bot.send_message(
            message.chat.id,
            f"گروه کامنت/بحث فعلی: {cur}\n\n"
            "۱) کانال → تنظیمات → Discussion → گروه جدید یا موجود را وصل کنید\n"
            "۲) ربات را **ادمین آن گروه** کنید\n"
            "۳) یکی از این‌ها را بفرستید:\n"
            "   /discussion @yourcommentgroup\n"
            "   /discussion -1001234567890\n"
            "   یا یک پیام از داخل گروه را همین‌جا فوروارد کنید\n\n"
            "خاموش: /discussion off\n"
            "متن **کامل** فارسی بعد از انتشار در کانال، در این گروه (به‌صورت ریپلای روی پست) می‌رود.",
        )
        return
    arg = parts[1].strip()
    if arg.lower() in ("off", "clear", "0"):
        try:
            sb_patch(
                f"bot_users?telegram_id=eq.{message.from_user.id}",
                {"discussion_chat_id": None, "discussion_username": None, "updated_at": utcnow_iso()},
            )
        except Exception as e:
            bot.send_message(message.chat.id, f"خطا: {e}")
            return
        bot.send_message(message.chat.id, "⚪️ ارسال متن کامل به گروه کامنت خاموش شد.")
        return
    chat_id = None
    uname = None
    title = None
    try:
        if arg.startswith("@") or not arg.lstrip("-").isdigit():
            ch = bot.get_chat(arg if arg.startswith("@") else "@" + arg.lstrip("@"))
        else:
            ch = bot.get_chat(int(arg))
        chat_id = ch.id
        title = getattr(ch, "title", None)
        uname = getattr(ch, "username", None)
    except Exception as e:
        bot.send_message(
            message.chat.id,
            f"گروه پیدا نشد یا ربات عضو/ادمین نیست: {e}\n"
            "بات را به گروه کامنت اضافه و ادمین کنید، سپس دوباره /discussion بزنید.",
        )
        return
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{message.from_user.id}",
            {
                "discussion_chat_id": chat_id,
                "discussion_username": uname,
                "updated_at": utcnow_iso(),
            },
        )
    except Exception as e:
        bot.send_message(
            message.chat.id,
            f"ذخیره نشد (ابتدا sql/03 را در Supabase اجرا کنید): {e}",
        )
        return
    bot.send_message(
        message.chat.id,
        f"✅ گروه کامنت متصل شد:\n{title or ''}\n@{uname or '—'}\nchat_id: {chat_id}\n\n"
        "از این پس بعد از هر پست کانال، متن کامل فارسی در گروه ارسال می‌شود.",
    )


@bot.message_handler(commands=["footer"])
def cmd_footer(message):
    user = upsert_user(message)
    parts = (message.text or "").split(" ", 1)
    if len(parts) < 2:
        cur = user.get("channel_footer") or DEFAULT_CHANNEL_FOOTER or "—"
        bot.send_message(
            message.chat.id,
            f"متن پایانی فعلی:\n{cur}\n\n"
            "✍️ متن پایانی هر پست کانال را بفرستید.\n\n"
            "ساده:\n"
            "/footer @mynews\n\n"
            "لینک‌دار (نام + لینک) — مثل Ctrl+K:\n"
            "/footer [کانال خبر](https://t.me/mynews)\n"
            "یا HTML:\n"
            "/footer <a href=\"https://t.me/mynews\">کانال خبر</a>\n\n"
            "پاک کردن:\n"
            "/footer clear",
        )
        return
    val = parts[1].strip()
    if val.lower() in ("clear", "off", "حذف"):
        val = ""
    try:
        sb_patch(
            f"bot_users?telegram_id=eq.{message.from_user.id}",
            {"channel_footer": val[:300], "updated_at": utcnow_iso()},
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا در ذخیره فوتر (sql/02 را اجرا کنید): {e}")
        return
    bot.send_message(
        message.chat.id,
        f"✅ متن پایانی {'حذف شد' if not val else 'ثبت شد'}:\n{val or '—'}",
        parse_mode="HTML",
    )


def _run_ai_test(user_id: int, user: dict):
    provider, _base, key, model = resolve_ai(user)
    try:
        bot.send_message(user_id, f"🧪 تست زنجیره — شروع از {provider} · {model} …")
    except Exception:
        pass
    text, used = ai_persian_post(
        title="The government announced a new technology plan for schools",
        summary="Officials said the plan will fund laptops and internet access for students over the next two years.",
        source_name="Test",
        source_lang="en",
        url="https://example.com/test",
        user=user,
    )
    status = "✅ AI فارسی" if used else "⚠️ فالبک — هیچ ارائه‌دهنده‌ای پاسخ نداد"
    try:
        bot.send_message(
            user_id,
            f"{status}\n\n{text}",
            parse_mode="HTML",
            disable_web_page_preview=True,
        )
    except Exception:
        try:
            bot.send_message(user_id, f"{status}\n\n{text}")
        except Exception as e:
            log.error("testai send: %s", e)


def _probe_model(base_url: str, api_key: str, model: str) -> tuple[bool, str]:
    try:
        content = chat_completion(
            base_url,
            api_key,
            model,
            "Reply in Persian only with: سلام",
            "Say hello in Persian.",
            timeout=18.0,
        )
        if not content:
            return False, "empty"
        if not looks_persian(content):
            return False, f"not FA: {content[:60]!r}"
        return True, content[:40]
    except AIError as e:
        return False, str(e)[:160]
    except Exception as e:
        return False, str(e)[:160]


def _run_ai_check(user_id: int, user: dict):
    """Probe every provider in AI_CHAIN (first model each); pick first healthy."""
    lines = ["🔎 بررسی زنجیرهٔ ارائه‌دهنده‌ها…\n"]
    results: list[tuple[str, str, bool, str]] = []

    def flush():
        try:
            bot.send_message(user_id, "\n".join(lines)[:3900])
        except Exception as e:
            log.error("aicheck send: %s", e)

    try:
        # chain_candidates() triggers /v1/models discovery for Vyce
        pairs = chain_candidates(user)
        by_provider: dict[str, list[str]] = {}
        for p, m in pairs:
            by_provider.setdefault(p, []).append(m)

        for p in AI_CHAIN:
            prov = PROVIDERS[p]
            if not prov["key"]:
                lines.append(f"⚪️ {prov['label']} · کلید ندارد")
                continue
            seen = by_provider.get(p, [])
            if not seen:
                ids = discover_models(p, force=True)
                seen = ids or ([prov["model"]] if prov["model"] else [])
                if not seen:
                    lines.append(f"❌ {prov['label']} · مدلی پیدا نشد (VYCE_MODEL را دستی ست کنید)")
                    continue
                lines.append(f"🔍 {prov['label']} مدل‌ها: {', '.join(seen[:4])}")
            for mid in seen[:6]:
                try:
                    bot.send_message(user_id, f"⏳ {prov['label']} · {mid} …")
                except Exception:
                    pass
                ok, detail = _probe_model(prov["base"], prov["key"], mid)
                mark_ai_health(p, mid, None if ok else detail)
                results.append((p, mid, ok, detail))
                icon = "✅" if ok else "❌"
                lines.append(f"{icon} {prov['label']} · {mid}\n   {str(detail)[:140]}")
                flush()
                if ok and prov.get("discover"):
                    break  # first working discovered model is enough
            time.sleep(0.3)

        healthy = [(p, m) for p, m, ok, _ in results if ok]
        if healthy:
            # prefer chain order
            order = {p: i for i, p in enumerate(AI_CHAIN)}
            healthy.sort(key=lambda x: order.get(x[0], 99))
            pref = healthy[0]
            try:
                sb_patch(
                    f"bot_users?telegram_id=eq.{user_id}",
                    {"ai_provider": pref[0], "ai_model": pref[1], "updated_at": utcnow_iso()},
                )
            except Exception as e:
                lines.append(f"(ذخیره مدل ناموفق: {e})")
            lines.append(f"\n✅ مدل سالم انتخاب شد:\n{PROVIDERS[pref[0]]['label']} · {pref[1]}")
            lines.append(f"زنجیره: {' → '.join(AI_CHAIN)}")
            global ALL_DOWN_SINCE
            ALL_DOWN_SINCE = None
        else:
            lines.append("\n❌ هیچ مدل سالمی نبود. تست خودکار مجدد "
                         f"تا {ALL_DOWN_RECHECK_SEC // 60} دقیقه دیگر.")
        flush()
    except Exception as e:
        try:
            bot.send_message(user_id, f"❌ aicheck crash: {e}")
        except Exception:
            pass
        log.error("aicheck crashed: %s", e)


@bot.message_handler(commands=["testai"])
def cmd_testai(message):
    user = upsert_user(message)
    _run_ai_test(message.chat.id, user)


@bot.message_handler(commands=["aicheck", "aimodels"])
def cmd_aicheck(message):
    user = upsert_user(message)
    bot.send_message(message.chat.id, "⏳ در حال تست همه مدل‌ها…")
    threading.Thread(target=lambda: _run_ai_check(message.chat.id, user), daemon=True).start()


@bot.message_handler(commands=["sourcescheck", "feedcheck"])
def cmd_sourcescheck(message):
    user = upsert_user(message)
    try:
        sources = sb_get(f"sources?user_id=eq.{user['telegram_id']}&enabled=eq.true&order=name.asc&limit=50")
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")
        return
    if not sources:
        bot.send_message(message.chat.id, "منبع فعالی نیست. /sources")
        return
    bot.send_message(message.chat.id, f"⏳ بررسی {len(sources)} فید…")

    def work():
        ok_n = bad_n = 0
        lines = ["📡 وضعیت منابع:\n"]
        for s in sources:
            code, items, title = check_feed(s["url"])
            good = code == 200 and items > 0
            ok_n += 1 if good else 0
            bad_n += 0 if good else 1
            mark = "✅" if good else "❌"
            lines.append(f"{mark} {s['name']} | HTTP {code} | items={items}")
            if not good:
                lines.append(f"   {s['url'][:80]}")
                lines.append(f"   {title[:80]}")
        lines.append(f"\nجمع: {ok_n} سالم · {bad_n} خراب")
        lines.append("برای حذف خرابی‌ها: /togglesource <id>")
        lines.append("فیدهای جدید: /addsource")
        try:
            bot.send_message(message.chat.id, "\n".join(lines)[:3900])
        except Exception as e:
            log.error("sourcescheck send: %s", e)

    threading.Thread(target=work, daemon=True).start()


@bot.message_handler(commands=["rescan", "retryfailed"])
def cmd_rescan(message):
    user = upsert_user(message)
    try:
        rows = sb_get(f"drafts?user_id=eq.{user['telegram_id']}&status=in.(failed)&limit=500")
        n = 0
        for d in rows:
            try:
                sb_patch(
                    f"drafts?id=eq.{d['id']}",
                    {"status": "pending", "error": None, "updated_at": utcnow_iso()},
                )
                n += 1
            except Exception:
                pass
        # also clear AI health so models retry
        AI_HEALTH.clear()
        bot.send_message(
            message.chat.id,
            f"✅ {n} پیش‌نویس ناموفق برای تلاش مجدد بازگشت. AI health پاک شد.\n/scan",
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


FEED_URL_FIXES = {
    "https://www.tabnak.ir/rss": "https://www.tabnak.ir/fa/rss/allnews",
    "https://www.varzesh3.com/rss": "https://www.varzesh3.com/rss/all",
    "https://www.digiato.com/feed": "https://digiato.com/feed/",
}


@bot.message_handler(commands=["fixsources"])
def cmd_fixsources(message):
    """Repair known-bad feed URLs already stored in the user's sources table."""
    user = upsert_user(message)
    fixed = 0
    added = []
    try:
        rows = sb_get(f"sources?user_id=eq.{user['telegram_id']}&limit=100")
        for s in rows:
            new_url = FEED_URL_FIXES.get(s.get("url"))
            if new_url and new_url != s.get("url"):
                sb_patch(f"sources?id=eq.{s['id']}", {"url": new_url})
                fixed += 1
                log.info("fix source %s -> %s", s.get("name"), new_url)
        have = {r.get("url") for r in rows}
        for extra in DEFAULT_SOURCES:
            if extra["url"] not in have:
                try:
                    sb_post("sources", [{
                        "user_id": user["telegram_id"],
                        "name": extra["name"],
                        "url": extra["url"],
                        "lang": extra.get("lang", "en"),
                        "category": extra.get("category", "world"),
                        "enabled": True,
                    }])
                    added.append(extra["name"])
                except Exception:
                    pass
        msg = f"✅ URLهای خراب اصلاح شد: {fixed}"
        if added:
            msg += f"\n➕ منابع افزوده‌شده: {', '.join(added)}"
        msg += "\nحالا /sourcescheck و /rescan و /scan"
        bot.send_message(message.chat.id, msg)
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


@bot.message_handler(commands=["digest"])
def cmd_digest(message):
    user = upsert_user(message)
    parts = (message.text or "").split()
    if len(parts) >= 2:
        arg = parts[1].lower()
        if arg in ("on", "روشن", "true"):
            _set_digest(user["telegram_id"], enabled=True)
            bot.send_message(message.chat.id, "🟢 مرور خبری روشن شد.")
            return
        if arg in ("off", "خاموش", "false"):
            _set_digest(user["telegram_id"], enabled=False)
            bot.send_message(message.chat.id, "⚪️ مرور خبری خاموش شد.")
            return
        if arg in ("now", "test", "امتحان"):
            u = get_user(user["telegram_id"]) or user
            ok, detail = publish_digest_for_user(u, force=True)
            bot.send_message(
                message.chat.id,
                f"✅ مرور منتشر شد ({detail})." if ok else f"❌ {detail}",
            )
            return
        m = re.fullmatch(r"(?:every|h|هر)?\s*(\d{1,3})\s*(h|hour|ساعت)?", arg)
        if m:
            hours = max(1, min(168, int(m.group(1))))
            _set_digest(user["telegram_id"], hours=hours)
            bot.send_message(message.chat.id, f"⏱ مرور هر {hours} ساعت تنظیم شد.")
            return
        if arg == "status":
            u = get_user(user["telegram_id"]) or user
            bot.send_message(
                message.chat.id,
                f"مرور: {'روشن' if digest_enabled(u) else 'خاموش'} · هر {digest_interval_hours(u)} ساعت\n"
                f"آخرین: {u.get('digest_last_at') or '—'}",
            )
            return
    u = get_user(user["telegram_id"]) or user
    bot.send_message(
        u["telegram_id"],
        "🗞 مرور خبری دوره‌ای\n\n"
        f"وضعیت: {'روشن' if digest_enabled(u) else 'خاموش'}\n"
        f"فاصله: هر {digest_interval_hours(u)} ساعت\n"
        f"آخرین ارسال: {u.get('digest_last_at') or '—'}\n\n"
        "دستورها:\n"
        "/digest on | off\n"
        "/digest 6 | 12 | 24   (ساعت)\n"
        "/digest now  (تست فوری)\n"
        "تیتر هر خبر لینک مستقیم به همان پست کانال است.",
        reply_markup=digest_keyboard(u),
    )


def _set_digest(user_id: int, enabled: bool | None = None, hours: int | None = None):
    fields = {"updated_at": utcnow_iso()}
    if enabled is not None:
        fields["digest_enabled"] = enabled
    if hours is not None:
        fields["digest_interval_hours"] = max(1, min(168, hours))
    try:
        sb_patch(f"bot_users?telegram_id=eq.{user_id}", fields)
    except Exception as e:
        log.warning("set_digest patch (run sql/04?): %s", e)
        # minimal fallback without new columns
        try:
            sb_patch(f"bot_users?telegram_id=eq.{user_id}", {"updated_at": utcnow_iso()})
        except Exception:
            pass


@bot.message_handler(commands=["bot"])
def cmd_bot(message):
    global BOT_ACTIVE
    if ADMIN_TELEGRAM_IDS and message.from_user.id not in ADMIN_TELEGRAM_IDS:
        bot.send_message(message.chat.id, "فقط ادمین.")
        return
    parts = (message.text or "").split()
    if len(parts) < 2:
        bot.send_message(
            message.chat.id,
            f"🤖 وضعیت ربات: {'فعال 🟢' if BOT_ACTIVE else 'غیرفعال ⚪️'}\n\n"
            "دستورات:\n"
            "/bot on  — شروع اسکن و انتشار خبر\n"
            "/bot off — توقف اسکن (کانال‌ها و دستورات فعال می‌مانند)\n"
            "/bot status — نمایش وضعیت فعلی",
        )
        return
    arg = parts[1].lower()
    if arg in ("on", "روشن", "true", "1"):
        BOT_ACTIVE = True
        bot.send_message(message.chat.id, "✅ ربات فعال شد. اسکن و انتشار ادامه دارد.")
    elif arg in ("off", "خاموش", "false", "0"):
        BOT_ACTIVE = False
        bot.send_message(message.chat.id, "⚪️ ربات غیرفعال شد. اسکن متوقف شد. /bot on برای فعال‌سازی.")
    elif arg in ("status", "وضعیت"):
        bot.send_message(
            message.chat.id,
            f"🤖 وضعیت فعلی: {'فعال 🟢' if BOT_ACTIVE else 'غیرفعال ⚪️'}\n"
            f"اسکن هر: {SCAN_INTERVAL_SEC} ثانیه",
        )
    else:
        bot.send_message(message.chat.id, "استفاده: /bot on | off | status")


@bot.message_handler(commands=["filter"])
def cmd_filter(message):
    """Manage article filters: block keywords, categories, sources."""
    user = upsert_user(message)
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        _send_filter_help(message.chat.id)
        return

    action = parts[1].lower()
    uid = user["telegram_id"]

    if action in ("list", "show", "لیست", "نمایش"):
        try:
            filters = sb_get(f"article_filters?user_id=eq.{uid}&order=id.asc&limit=200")
        except Exception as e:
            bot.send_message(message.chat.id, f"خطا (migration 07 را اجرا کنید): {e}")
            return
        if not filters:
            bot.send_message(message.chat.id, "🚫 فیلتر فعالی نیست. /filter add")
            return
        lines = ["🎯 فیلترهای شما:\n"]
        for f in filters:
            mark = "🟢" if f.get("enabled") else "⚪️"
            ft = f.get("filter_type", "")
            fv = f.get("match_value", "")
            fname = f.get("filter_name", "")
            label = f" (#{f['id']})"
            lines.append(f"{mark} {fname or ft}{label}\n   نوع: {ft}\n   مقدار: {fv}")
        bot.send_message(message.chat.id, "\n".join(lines)[:MAX_TG_MESSAGE])
        return

    if action in ("on", "off", "فعال", "غیرفعال"):
        try:
            all_f = sb_get(f"article_filters?user_id=eq.{uid}&limit=200")
            val = action in ("on", "فعال")
            for f in all_f:
                sb_patch(f"article_filters?id=eq.{f['id']}", {"enabled": val})
            bot.send_message(
                message.chat.id,
                f"✅ فیلترها: {'فعال 🟢' if val else 'غیرفعال ⚪️'} شد."
            )
        except Exception as e:
            bot.send_message(message.chat.id, f"خطا (migration 07 را اجرا کنید): {e}")
        return

    if action in ("add", "اضافه"):
        _filter_add(message, parts, uid, user)
        return

    if action in ("del", "remove", "حذف"):
        if len(parts) < 3 or not parts[2].isdigit():
            bot.send_message(message.chat.id, "فرمت: /filter del <id>")
            return
        fid = int(parts[2])
        try:
            sb_delete(f"article_filters?id=eq.{fid}&user_id=eq.{uid}")
            bot.send_message(message.chat.id, f"✅ فیلتر #{fid} حذف شد.")
        except Exception as e:
            bot.send_message(message.chat.id, f"❌ خطا: {e}")
        return

    _send_filter_help(message.chat.id)


def _send_filter_help(chat_id: int):
    bot.send_message(chat_id, """🎯 فیلترهای خبر
    
فرمت: /filter <عملونرما> [آرگومان]
    
• /filter list     — نمایش فیلترهای فعال
• /filter on/off   — فعال/غیرفعال کردن همه فیلترها
• /filter add <نوع> <مقدار> <نام (اختیاری)>
• /filter del <id>  — حذف یک فیلتر
    
انواع فیلتر:
  block_keyword    — بلاک خبرهای حاوی کلمه
  block_category   — بلاک خبرهای یک دسته (world, tech, ...)
  block_source     — بلاک اخبار یک منبع
  only_keyword     — فقط خبرهایی که حاوی این کلمه باشد
    
مثال:
  /filter add block_keyword جنگ
  /filter add block_category sports
  /filter add only_keyword هوش مصنوعی
""")


def _filter_add(message, parts, uid: int, user: dict):
    if len(parts) < 3:
        bot.send_message(message.chat.id, "فرمت: /filter add <type> <value> [label]")
        bot.send_message(message.chat.id,
                         "نوع: block_keyword | block_category | block_source | only_keyword")
        return
    ftype = parts[2].strip().lower()
    if ftype not in ("block_keyword", "block_category", "block_source", "only_keyword"):
        bot.send_message(message.chat.id,
                         "نوع نامعتبر. نوع: block_keyword | block_category | block_source | only_keyword")
        return
    rest = parts[3] if len(parts) > 3 else ""
    value_and_label = rest.split("|", 1) if "|" in rest else (rest, "")
    fval = value_and_label[0].strip()
    if not fval:
        bot.send_message(message.chat.id, "مقدار (کلمه/دسته/منبع) لازم است.")
        return
    fname = value_and_label[1].strip() if len(value_and_label) > 1 else f"{ftype}: {fval}"
    try:
        rows = sb_post("article_filters", [{
            "user_id": uid,
            "filter_name": fname[:100],
            "filter_type": ftype,
            "match_value": fval[:300],
            "enabled": True,
        }])
        if rows:
            bot.send_message(message.chat.id, f"✅ فیلتر اضافه شد: {ftype} = {fval}")
        else:
            bot.send_message(message.chat.id, f"✅ فیلتر اضافه شد: {ftype} = {fval}")
    except Exception as e:
        bot.send_message(message.chat.id, f"❌ خطا (migration 07 را اجرا کنید): {e}")


@bot.message_handler(commands=["adminstats"])
def cmd_adminstats(message):
    if ADMIN_TELEGRAM_IDS and message.from_user.id not in ADMIN_TELEGRAM_IDS:
        bot.send_message(message.chat.id, "دسترسی ادمین ندارید.")
        return
    try:
        users = sb_get("bot_users?limit=500")
        drafts = sb_get("drafts?limit=5")
        pub = sb_get("drafts?status=eq.published&limit=500")
        bot.send_message(
            message.chat.id,
            f"📊 کاربران: {len(users)}\nمنتشرشده (نمونه): {len(pub)}\n"
            f"DeepSeek: {'فعال' if DEEPSEEK_API_KEY else 'غیرفعال'} · "
            f"Dahl: {'فعال' if DAHL_API_KEY else 'غیرفعال'} · default={AI_PROVIDER}",
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا: {e}")


# ============================================================
# Free-text: channel username / forward
# ============================================================

@bot.message_handler(
    func=lambda m: m.from_user and (
        m.from_user.id in awaiting_channel
        or (m.forward_from_chat is not None and getattr(m.forward_from_chat, "type", "") in ("supergroup", "group"))
    ),
    content_types=["text", "forward_from", "forward_from_chat"],
)
def on_channel_bind(message):
    user_id = message.from_user.id
    chat_id = None
    username = None
    title = None
    bind_kind = "channel" if user_id in awaiting_channel else "discussion"

    # Forwarded channel/group post
    if getattr(message, "forward_from_chat", None):
        ch = message.forward_from_chat
        if ch.type in ("channel", "supergroup", "group"):
            chat_id = ch.id
            username = getattr(ch, "username", None)
            title = ch.title
            if ch.type != "channel" and user_id not in awaiting_channel:
                bind_kind = "discussion"
            elif ch.type != "channel" and user_id in awaiting_channel:
                # user forwarded a group while in channel-bind mode
                bind_kind = "discussion"
                awaiting_channel.discard(user_id)
    elif message.text and message.text.strip().startswith("@"):
        username = message.text.strip().lstrip("@")
        try:
            ch = bot.get_chat("@" + username)
            chat_id = ch.id
            title = ch.title
            username = getattr(ch, "username", None) or username
        except Exception as e:
            bot.send_message(
                message.chat.id,
                f"کانال پیدا نشد یا ربات ادمین نیست: {e}\n"
                "بات را به کانال اضافه کنید و دوباره @یوزرنیم را بفرستید.",
            )
            return
    elif message.text and re.fullmatch(r"-?\d+", message.text.strip()):
        chat_id = int(message.text.strip())
        try:
            ch = bot.get_chat(chat_id)
            title = ch.title
            username = getattr(ch, "username", None)
        except Exception as e:
            bot.send_message(message.chat.id, f"chat_id نامعتبر است: {e}")
            return
    else:
        bot.send_message(message.chat.id, "لطفاً @یوزرنیم کانال یا فوروارد پست کانال را بفرستید. /cancel")
        return

    if not chat_id:
        bot.send_message(message.chat.id, "شناسه کانال دریافت نشد.")
        return

    if bind_kind == "discussion":
        try:
            member = bot.get_chat_member(chat_id, bot.get_me().id)
            if member.status not in ("administrator", "creator", "member"):
                bot.send_message(message.chat.id, f"ربات در گروه دسترسی ندارد: {member.status}")
                return
        except Exception as e:
            bot.send_message(message.chat.id, f"خطا در بررسی گروه: {e}")
            return
        try:
            sb_patch(
                f"bot_users?telegram_id=eq.{user_id}",
                {
                    "discussion_chat_id": chat_id,
                    "discussion_username": username,
                    "updated_at": utcnow_iso(),
                },
            )
        except Exception as e:
            bot.send_message(message.chat.id, f"sql/03 را اجرا کنید سپس دوباره: {e}")
            return
        awaiting_channel.discard(user_id)
        bot.send_message(
            message.chat.id,
            f"✅ گروه کامنت/بحث متصل شد:\n{title or ''}\n@{username or '—'}\nchat_id: {chat_id}\n\n"
            "متن **کامل** فارسی هر خبر بعد از انتشار در کانال، در این گروه ارسال می‌شود.",
        )
        return

    # Permission smoke-test for channel
    try:
        member = bot.get_chat_member(chat_id, bot.get_me().id)
        if member.status not in ("administrator", "creator"):
            bot.send_message(
                message.chat.id,
                "ربات در این کانال ادمین نیست. در تنظیمات کانال ربات را Admin کنید "
                "(با دسترسی Delete messages) و دوباره تلاش کنید.",
            )
            return
    except Exception as e:
        bot.send_message(message.chat.id, f"خطا در بررسی دسترسی ربات در کانال: {e}")
        return

    sb_patch(
        f"bot_users?telegram_id=eq.{user_id}",
        {
            "channel_id": chat_id,
            "channel_username": username,
            "channel_title": title,
            "updated_at": utcnow_iso(),
        },
    )
    awaiting_channel.discard(user_id)
    bot.send_message(
        message.chat.id,
        f"✅ کانال متصل شد:\n{title or ''}\n@{username or '—'}\nchat_id: {chat_id}\n\n"
        "حالا /auto on یا /auto off را تنظیم کنید و /scan بزنید.\n"
        "گروه کامنت: /discussion @group",
    )


@bot.message_handler(
    func=lambda m: (
        m.chat
        and m.chat.type in ("group", "supergroup")
        and (
            (getattr(m, "sender_chat", None) is not None and getattr(m.sender_chat, "type", "") == "channel")
            or (getattr(m, "forward_from_chat", None) is not None
                and getattr(m.forward_from_chat, "type", "") == "channel")
        )
    ),
    content_types=["text", "photo", "video", "document", "audio", "voice", "video_note", "animation", "sticker"],
)
def on_mirror_post(message):
    """Record the group-local id of a mirrored channel post (comment target)."""
    ch = getattr(message, "sender_chat", None) or getattr(message, "forward_from_chat", None)
    _remember_mirror(message.chat.id, message.message_id, getattr(ch, "id", None))
    log.info(
        "mirror captured group=%s msg=%s channel=%s",
        message.chat.id, message.message_id, getattr(ch, "id", None),
    )


@bot.message_handler(func=lambda m: m.chat.type == "private", content_types=["text"])
def on_unknown_text(message):
    bot.send_message(message.chat.id, "دستور ناشناخته. /help", reply_markup=main_menu_keyboard())


# ============================================================
# Callback buttons
# ============================================================

@bot.callback_query_handler(func=lambda c: True)
def on_callback(call):
    global BOT_ACTIVE
    data = call.data or ""
    user = get_user(call.from_user.id)
    if not user:
        try:
            bot.answer_callback_query(call.id, "ابتدا /start بزنید")
        except Exception:
            pass
        return

    try:
        bot.answer_callback_query(call.id)
    except Exception:
        pass

    if data.startswith("pub:"):
        _cb_publish(call, user)
    elif data.startswith("rej:"):
        _cb_reject(call, user)
    elif data.startswith("regen:"):
        _cb_regen(call, user)
    elif data.startswith("del:"):
        _cb_delete(call, user)
    elif data == "set:toggle_auto":
        new_val = not bool(user.get("auto_publish"))
        sb_patch(
            f"bot_users?telegram_id=eq.{user['telegram_id']}",
            {"auto_publish": new_val, "updated_at": utcnow_iso()},
        )
        u2 = get_user(user["telegram_id"])
        try:
            bot.edit_message_text(
                settings_text(u2),
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=settings_keyboard(u2),
            )
        except Exception:
            pass
    elif data == "menu:digest":
        u = get_user(user["telegram_id"]) or user
        try:
            bot.edit_message_text(
                f"🗞 مرور خبری\n"
                f"وضعیت: {'روشن' if digest_enabled(u) else 'خاموش'}\n"
                f"فاصله: هر {digest_interval_hours(u)} ساعت\n"
                f"آخرین: {u.get('digest_last_at') or '—'}\n\n"
                "تیترها به همان پست کانال لینک می‌شوند.",
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=digest_keyboard(u),
            )
        except Exception:
            bot.send_message(call.from_user.id, "منوی مرور", reply_markup=digest_keyboard(u))
    elif data.startswith("set:digest:"):
        _cb_digest(call, user, data.split(":", 2)[2])
    elif data == "set:toggle_digest":
        _set_digest(user["telegram_id"], enabled=not digest_enabled(user))
        u2 = get_user(user["telegram_id"]) or user
        try:
            bot.edit_message_text(
                settings_text(u2),
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=settings_keyboard(u2),
            )
        except Exception:
            pass
    elif data.startswith("set:ai:"):
        p = data.split(":", 2)[2].lower()
        if p not in PROVIDERS:
            return
        if not PROVIDERS[p]["key"]:
            bot.send_message(call.from_user.id, f"کلید {PROVIDERS[p]['label']} در Deployka ست نشده.")
            return
        default_model = PROVIDERS[p]["model"]
        sb_patch(
            f"bot_users?telegram_id=eq.{user['telegram_id']}",
            {"ai_provider": p, "ai_model": default_model, "updated_at": utcnow_iso()},
        )
        u2 = get_user(user["telegram_id"])
        try:
            bot.edit_message_text(
                "🤖 انتخاب هوش مصنوعی / مدل",
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=ai_menu_keyboard(u2),
            )
        except Exception:
            pass
    elif data.startswith("set:model:"):
        model = data.split(":", 2)[2]
        sb_patch(
            f"bot_users?telegram_id=eq.{user['telegram_id']}",
            {"ai_model": model[:120], "updated_at": utcnow_iso()},
        )
        u2 = get_user(user["telegram_id"])
        try:
            bot.edit_message_text(
                "🤖 انتخاب هوش مصنوعی / مدل",
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=ai_menu_keyboard(u2),
            )
        except Exception:
            pass
    elif data == "menu:ai":
        try:
            bot.edit_message_text(
                "🤖 ارائه‌دهنده و مدل هوش مصنوعی",
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=ai_menu_keyboard(user),
            )
        except Exception:
            bot.send_message(call.from_user.id, "منوی AI", reply_markup=ai_menu_keyboard(user))
    elif data == "menu:testai":
        _run_ai_test(call.from_user.id, user)
    elif data == "menu:balance":
        bot.send_message(call.from_user.id, "⏳ بررسی موجودی…")
        threading.Thread(target=lambda: _run_balance(call.from_user.id), daemon=True).start()
    elif data == "menu:aicheck":
        bot.send_message(call.from_user.id, "⏳ در حال تست همه مدل‌ها…")
        threading.Thread(target=lambda: _run_ai_check(call.from_user.id, user), daemon=True).start()
    elif data == "menu:footer":
        bot.send_message(
            call.from_user.id,
            "✍️ متن کوتاه پایانی هر پست کانال را بفرستید:\n"
            "/footer 📰 @yourchannel\n\n"
            "پاک کردن: /footer clear",
        )
    elif data == "menu:scan":
        bot.send_message(call.from_user.id, "⏳ اسکن…")
        threading.Thread(target=lambda: _scan_and_notify(call.from_user.id), daemon=True).start()
    elif data == "menu:review":
        cmd_review_fake(call.from_user.id)
    elif data == "menu:settings":
        cmd_settings_fake(call.from_user.id, user)
    elif data == "menu:channel":
        awaiting_channel.add(call.from_user.id)
        bot.send_message(
            call.from_user.id,
            "یوزرنیم کانال (@name) یا فوروارد پست کانال را بفرستید. /cancel",
        )
    elif data == "menu:delete":
        cmd_published_fake(call.from_user.id)
    elif data == "menu:sources":
        cmd_sources_fake(call.from_user.id, user)
    elif data == "menu:discussion":
        bot.send_message(
            call.from_user.id,
            "گروه کامنت/بحث:\n"
            "۱) کانال → تنظیمات → Discussion → گروه جدید یا موجود را وصل کنید\n"
            "۲) ربات را ادمین آن گروه کنید\n"
            "۳) /discussion @yourcommentgroup\n\n"
            "غیرفعال: /discussion off\n"
            "متن کامل فارسی بعد از انتشار در کانال، در این گروه ارسال می‌شود.",
        )
    elif data == "menu:filters":
        cmd_filter(message=None, user=user, chat_id=call.from_user.id) if False else bot.send_message(
            call.from_user.id,
            "🎯 فیلترها:\n"
            "/filter list — لیست فیلترها\n"
            "/filter add block_keyword <کلمه> — بلاک خبرهای حاوی کلمه\n"
            "/filter add block_category <دسته> — بلاک دسته‌بندی (world, tech, ...)\n"
            "/filter add block_source <نام منبع> — بلاک منبع\n"
            "/filter add only_keyword <کلمه> — فقط خبرهایی حاوی این کلمه\n"
            "/filter del <id> — حذف فیلتر\n"
            "/filter on|off — فعال/غیرفعال کردن همه",
        )
    elif data == "set:bot_on":
        if ADMIN_TELEGRAM_IDS and user["telegram_id"] not in ADMIN_TELEGRAM_IDS:
            bot.send_message(call.from_user.id, "فقط ادمین.")
            return
        BOT_ACTIVE = True
        log.info("Bot re-activated via callback by user %s", user["telegram_id"])
        bot.send_message(call.from_user.id, "✅ ربات فعال شد. اسکن شروع می‌شود.")
        u2 = get_user(user["telegram_id"]) or user
        try:
            bot.edit_message_text(settings_text(u2), chat_id=call.message.chat.id, message_id=call.message.message_id, reply_markup=settings_keyboard(u2))
        except Exception:
            pass
    elif data == "set:bot_off":
        if ADMIN_TELEGRAM_IDS and user["telegram_id"] not in ADMIN_TELEGRAM_IDS:
            bot.send_message(call.from_user.id, "فقط ادمین.")
            return
        BOT_ACTIVE = False
        log.info("Bot deactivated via callback by user %s", user["telegram_id"])
        bot.send_message(call.from_user.id, "⚪️ ربات غیرفعال شد. اسکن متوقف شد. /bot on برای فعال‌سازی.")
        u2 = get_user(user["telegram_id"]) or user
        try:
            bot.edit_message_text(settings_text(u2), chat_id=call.message.chat.id, message_id=call.message.message_id, reply_markup=settings_keyboard(u2))
        except Exception:
            pass


def cmd_review_fake(user_id: int):
    class M:
        pass
    # reuse logic
    try:
        drafts = sb_get(
            f"drafts?user_id=eq.{user_id}&status=in.(pending,waiting_review)&order=id.desc&limit=10"
        )
    except Exception as e:
        bot.send_message(user_id, f"خطا: {e}")
        return
    if not drafts:
        bot.send_message(user_id, "📭 صف بررسی خالی است. /scan")
        return
    for d in reversed(drafts):
        arts = sb_get(f"articles?id=eq.{d['article_id']}&limit=1")
        art = arts[0] if arts else {"title": "", "source_name": "—", "category": "—"}
        send_review_card(user_id, d, art)


def settings_text(user: dict) -> str:
    uid = user.get("telegram_id", 0)
    provider, _b, key, model = resolve_ai(user)
    auto = bool(user.get("auto_publish"))
    ch = user.get("channel_username") or user.get("channel_id") or "—"
    disc = user.get("discussion_chat_id") or user.get("discussion_username") or "—"
    dig = "روشن" if digest_enabled(user) else "خاموش"
    filter_count = len(load_user_filters(uid))
    bot_status = "فعال 🟢" if BOT_ACTIVE else "غیرفعال ⚪️"
    return (
        f"⚙️ تنظیمات ربات\n\n"
        f"📺 کانال: {ch}\n"
        f"💬 گروه کامنت: {disc}\n"
        f"⚙️ ارسال اتومات: {'روشن' if auto else 'خاموش'}\n"
        f"🗞 مرور خبری: {dig} · هر {digest_interval_hours(user)} ساعت\n"
        f"آخرین مرور: {user.get('digest_last_at') or '—'}\n"
        f"🤖 هوش مصنوعی: {PROVIDERS.get(provider, {}).get('label', provider)} · {model}\n"
        f"🔑 کلید AI: {'دارد ✅' if key else 'ندارد ❌'}\n"
        f"🎯 فیلترهای شخصی: {filter_count} عدد\n"
        f"🤖 وضعیت ربات: {bot_status}\n"
        f"زنجیره: {' → '.join(AI_CHAIN)}\n"
        f"✍️ متن پایانی: {user.get('channel_footer') or DEFAULT_CHANNEL_FOOTER or '—'}\n"
        f"📡 اسکن هر: {SCAN_INTERVAL_SEC}s"
    )


def cmd_settings_fake(user_id: int, user: dict):
    try:
        bot.send_message(user_id, settings_text(user), reply_markup=settings_keyboard(user))
    except Exception as e:
        bot.send_message(user_id, f"خطا: {e}")


def cmd_sources_fake(user_id: int, user: dict):
    try:
        rows = sb_get(f"sources?user_id=eq.{user['telegram_id']}&order=name.asc&limit=50")
        lines = ["📡 منابع:\n"]
        for r in rows:
            mark = "🟢" if r.get("enabled") else "⚪️"
            lines.append(f"{mark} #{r['id']} {r['name']} [{r.get('category')}]")
        bot.send_message(user_id, "\n".join(lines)[:MAX_TG_MESSAGE])
    except Exception as e:
        bot.send_message(user_id, f"خطا: {e}")


def cmd_published_fake(user_id: int):
    class FakeMsg:
        chat = type("C", (), {"id": user_id})()
        from_user = type("U", (), {"id": user_id})()
        text = "/published"
    # simpler inline
    try:
        drafts = sb_get(
            f"drafts?user_id=eq.{user_id}&status=eq.published&order=published_at.desc&limit=10"
        )
    except Exception as e:
        bot.send_message(user_id, f"خطا: {e}")
        return
    if not drafts:
        bot.send_message(user_id, "هنوز پستی منتشر نشده است.")
        return
    for d in drafts:
        preview = (d.get("fa_text") or "")[:180]
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🗑 حذف از کانال", callback_data=f"del:{d['id']}"))
        bot.send_message(
            user_id,
            f"✅ #{d['id']}\n{preview}\n\nپیام: {d.get('published_message_id')}",
            reply_markup=kb,
        )


def _load_draft_owned(user, draft_id: int):
    rows = sb_get(f"drafts?id=eq.{draft_id}&user_id=eq.{user['telegram_id']}&limit=1")
    if not rows:
        return None, None
    d = rows[0]
    arts = sb_get(f"articles?id=eq.{d['article_id']}&limit=1")
    return d, (arts[0] if arts else {})


def _cb_publish(call, user):
    draft_id = int(call.data.split(":", 1)[1])
    if draft_id in processing_drafts:
        return
    processing_drafts.add(draft_id)
    try:
        draft, art = _load_draft_owned(user, draft_id)
        if not draft:
            bot.send_message(call.from_user.id, "پیش‌نویس پیدا نشد.")
            return
        text = draft.get("fa_text") or art.get("title") or ""
        full = draft.get("full_text") or ""
        t0 = time.time()
        ok, info = publish_draft(user, draft, text, art)
        if ok:
            try:
                # publish FIRST, then comment on the mirrored post
                discussion_publish(user, draft, full or text, info, since_ts=t0)
            except Exception as e:
                log.warning("discussion after manual publish: %s", e)
            try:
                bot.edit_message_text(
                    f"✅ منتشر شد در کانال (message_id={info})\n\n{text[:500]}",
                    chat_id=call.message.chat.id,
                    message_id=call.message.message_id,
                )
            except Exception:
                pass
        else:
            bot.send_message(call.from_user.id, f"❌ خطا در انتشار: {info}")
    finally:
        processing_drafts.discard(draft_id)


def _cb_reject(call, user):
    draft_id = int(call.data.split(":", 1)[1])
    draft, _ = _load_draft_owned(user, draft_id)
    if not draft:
        return
    sb_patch(
        f"drafts?id=eq.{draft_id}",
        {"status": "rejected", "updated_at": utcnow_iso()},
    )
    try:
        bot.edit_message_text(
            f"❌ رد شد #{draft_id}",
            chat_id=call.message.chat.id,
            message_id=call.message.message_id,
        )
    except Exception:
        pass


def _cb_regen(call, user):
    draft_id = int(call.data.split(":", 1)[1])
    draft, art = _load_draft_owned(user, draft_id)
    if not draft:
        return
    bot.send_message(call.from_user.id, "🔁 در حال بازنویسی با هوش مصنوعی…")

    def work():
        fa, used_ai = ai_persian_post(
            title=art.get("title") or "",
            summary=art.get("summary") or "",
            source_name=art.get("source_name") or "",
            source_lang=art.get("source_lang") or "en",
            url=art.get("url") or "",
            user=user,
            category=art.get("category") or "",
        )
        sb_patch(
            f"drafts?id=eq.{draft_id}",
            {"fa_text": fa, "status": "waiting_review", "updated_at": utcnow_iso()},
        )
        d2 = find_draft(user["telegram_id"], art.get("id") or draft["article_id"])
        send_review_card(user["telegram_id"], d2 or {**draft, "fa_text": fa, "status": "waiting_review"}, art)

    threading.Thread(target=work, daemon=True).start()


def _cb_digest(call, user, action: str):
    uid = user["telegram_id"]
    u = get_user(uid) or user
    if action == "on":
        _set_digest(uid, enabled=True)
    elif action == "off":
        _set_digest(uid, enabled=False)
    elif action == "now":
        ok, detail = publish_digest_for_user(u, force=True)
        try:
            bot.answer_callback_query(call.id, "منتشر شد" if ok else detail[:40])
        except Exception:
            pass
        bot.send_message(
            call.from_user.id,
            f"✅ مرور منتشر شد ({detail})." if ok else f"❌ {detail}",
        )
        return
    elif action.startswith("h") and action[1:].isdigit():
        _set_digest(uid, hours=int(action[1:]))
    u = get_user(uid) or u
    try:
        bot.edit_message_text(
            f"🗞 مرور خبری\n"
            f"وضعیت: {'روشن' if digest_enabled(u) else 'خاموش'}\n"
            f"فاصله: هر {digest_interval_hours(u)} ساعت\n"
            f"آخرین: {u.get('digest_last_at') or '—'}",
            chat_id=call.message.chat.id,
            message_id=call.message.message_id,
            reply_markup=digest_keyboard(u),
        )
    except Exception:
        pass


def _cb_delete(call, user):
    draft_id = int(call.data.split(":", 1)[1])
    draft, _ = _load_draft_owned(user, draft_id)
    if not draft:
        return
    ok, info = delete_from_channel(user, draft)
    try:
        bot.edit_message_text(
            f"🗑 حذف از کانال: {'موفق' if ok else 'ناموفق — ' + str(info)[:200]} (#{draft_id})",
            chat_id=call.message.chat.id,
            message_id=call.message.message_id,
        )
    except Exception:
        bot.send_message(call.from_user.id, f"حذف: {ok} {info}")


# ============================================================
# Main
# ============================================================

def main():
    log.info("NewsChannelBot v%s starting…", BOT_VERSION)
    log.info("News filters loaded from sql/07_filters.sql — /filter command available")
    try:
        reload_dynamic_keys()
    except Exception as e:
        log.warning("startup key reload: %s", e)
    chain_desc = ", ".join(f"{PROVIDERS[p]['label']}×{len(all_keys(p))}" for p in AI_CHAIN)
    log.info("AI chain: %s | start=%s", chain_desc, AI_PROVIDER)
    log.info("Auto default: %s | scan every %ss | max images=%s",
             DEFAULT_AUTO_PUBLISH, SCAN_INTERVAL_SEC, MAX_POST_IMAGES)

    # Background scanner
    t = threading.Thread(target=scanner_loop, daemon=True)
    t.start()

    log.info("Bot polling…")
    bot.infinity_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()

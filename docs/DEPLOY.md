# Deploy Guide — NewsChannelBot

> راهنمای فارسی در انتهای فایل (خلاصه) · Full English guide below.

This bot is a **long-running Python process** that uses Telegram **long polling**
(no inbound ports, no reverse proxy, no domain needed). It must simply *stay alive*.
This guide covers the most common ways to run it:

| Platform | Difficulty | Cost | Best for |
|---|---|---|---|
| **Deployka** | Easy | **Free tier: 128 MB RAM** | No server management — tested with this bot |
| **VPS + systemd** (Ubuntu/Debian) | Medium | ~$4–6/mo | Full control, cheapest long-term |
| **Docker / Docker Compose** | Medium | Any host | Reproducible, easy migrations |
| **Railway** (PaaS) | Easy | Usage-based | Zero server management |

> 💡 **No-code path:** you can delegate the whole deployment to an AI coding agent
> (Freebuff, OpenCode, Xiaomi MiMo AI, …): sign up on Supabase + Deployka yourself,
> give the agent this repo URL plus the 4 key values, and let it do the rest.

> **Before any deploy:** create the bot on [@BotFather](https://t.me/BotFather),
> create a [Supabase](https://supabase.com) project and run `sql/01_init.sql` …
> `sql/10_custom_providers.sql` **in order** in the SQL Editor.
> See the [README](../README.md) for the full setup tutorial.

---

## 0) Prepare your environment file

On every platform you need these env vars (copy from `.env.example`):

```env
BOT_TOKEN=123456:ABC-your-token
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJ...   # service_role key — keep it secret
AI_KEYS=dahl=sk-xxx   # or deepseek=sk-xxx
BOT_ACTIVE=true
```

⚠️ **Never** commit `.env` or paste real keys into Dockerfiles / railway.json.
Use each platform's secret mechanism (env file, dashboard variables, secrets manager).

---

## 1) VPS + systemd (Ubuntu / Debian)

### 1.1 Create the server

Any Ubuntu 22.04/24.04 VPS works (Hetzner, DigitalOcean, Vultr, ArvanCloud, …).
1 GB RAM is enough — the bot uses ~100–150 MB.

```bash
ssh root@YOUR_SERVER_IP
```

### 1.2 Create a dedicated user (recommended)

```bash
adduser newsbot
usermod -aG sudo newsbot
su - newsbot
```

### 1.3 Install Python 3.10+

```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip git
python3 --version   # must be 3.10 or newer
```

### 1.4 Get the code

```bash
cd /opt
sudo mkdir -p newschannelbot && sudo chown newsbot:newsbot newschannelbot
cd newschannelbot
git clone https://github.com/mohsen-niksirat/News-Channel-Bot.git .
```

Or upload the files with `scp` / SFTP if you don't want a public checkout:

```bash
# from your PC:
scp main.py sources_defaults.py requirements.txt .env.example newsbot@SERVER:/opt/newschannelbot/
```

### 1.5 Virtual env + dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 1.6 Configure environment

```bash
cp .env.example .env
nano .env    # fill BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, AI_KEYS
chmod 600 .env   # only the newsbot user can read it
```

### 1.7 Test run (foreground)

```bash
python main.py
```

You should see the login log. Send `/start` to your bot in Telegram — if it
replies, the setup works. Stop it with `Ctrl+C` and continue to systemd.

### 1.8 systemd service file

```bash
sudo nano /etc/systemd/system/newschannelbot.service
```

Paste (**edit paths if you used different ones**):

```ini
[Unit]
Description=NewsChannelBot - Telegram news bot
Documentation=https://github.com/mohsen-niksirat/News-Channel-Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=newsbot
Group=newsbot
WorkingDirectory=/opt/newschannelbot
EnvironmentFile=/opt/newschannelbot/.env
ExecStart=/opt/newschannelbot/.venv/bin/python /opt/newschannelbot/main.py
Restart=always
RestartSec=10
StartLimitBurst=0
KillSignal=SIGINT
TimeoutStopSec=20

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

> Note: `EnvironmentFile` requires `KEY=value` lines (no `export`, no quotes
> needed). python-dotenv in `main.py` also reads the same `.env`, so the two
> mechanisms are redundant-but-safe: if one fails the other still works.

### 1.9 Enable & start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now newschannelbot
sudo systemctl status newschannelbot
```

### 1.10 Logs & maintenance

```bash
# live logs
journalctl -u newschannelbot -f

# last 200 lines
journalctl -u newschannelbot -n 200 --no-pager

# restart after code update
cd /opt/newschannelbot && git pull
sudo systemctl restart newschannelbot

# stop / start / disable
sudo systemctl stop newschannelbot
sudo systemctl start newschannelbot
sudo systemctl disable newschannelbot
```

### 1.11 Update flow (summary)

```bash
sudo systemctl stop newschannelbot
cd /opt/newschannelbot && git pull
source .venv/bin/activate && pip install -r requirements.txt
sudo systemctl start newschannelbot
journalctl -u newschannelbot -f     # verify
```

---

## 2) Docker / Docker Compose

### 2.1 Dockerfile

Save this as `Dockerfile` in the repo root:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py sources_defaults.py ./

# Run as non-root user
RUN useradd -m botuser
USER botuser

CMD ["python", "main.py"]
```

### 2.2 docker-compose.yml

Save as `docker-compose.yml`:

```yaml
services:
  newschannelbot:
    build: .
    container_name: newschannelbot
    restart: unless-stopped
    env_file:
      - .env          # must exist next to this file (never commit it!)
    # long polling = no ports needed
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### 2.3 Run

```bash
cp .env.example .env && nano .env    # fill values
docker compose up -d --build

# logs
docker compose logs -f

# update
docker compose up -d --build   # after git pull

# stop / start
docker compose down
docker compose start
```

### 2.4 Build & push an image (optional)

```bash
docker build -t YOUR_DOCKERHUB_USER/newschannelbot:latest .
docker push YOUR_DOCKERHUB_USER/newschannelbot:latest
# then on the server:
docker run -d --name newschannelbot --env-file .env --restart unless-stopped \
  YOUR_DOCKERHUB_USER/newschannelbot:latest
```

> If you deploy the Dockerfile to the repo, add a
> `.dockerignore` with: `.env`, `.git`, `__pycache__/`, `*.zip`, `.venv/`
> so secrets never enter the image context.

---

## 3) Railway

Railway runs it as a normal long-running service (no ports needed).

### 3.0) Deployka (recommended, free tier)

The author runs this bot on [deployka.dev](https://deployka.dev/) — its free tier
provides **128 MB RAM**, enough for this bot (~100–150 MB RSS):

1. Sign up at [deployka.dev](https://deployka.dev/)
2. Create a new **Python service** and connect this GitHub repo (or upload
   `main.py`, `sources_defaults.py`, `requirements.txt`)
3. In **Environment** add the 4 required vars from step 0 above
   (`BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, `AI_KEYS`)
4. Start command: `python main.py`
5. Keep the service **always-on** (the scanner is a background thread)
6. Watch the service logs — the bot prints its startup banner there

> ⚠️ Too many env vars can exceed Deployka's per-service variable limit —
> use only the 4 required ones (everything else has code defaults).
> The bot's `AI_KEYS` compact format exists exactly for this.

### 3.1 Deploy from GitHub (recommended)

1. Push this repo to your GitHub (or fork it).
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. Pick the repo — Railway auto-detects Python and uses `requirements.txt`.
4. **Settings → Start Command:** `python main.py`
   (or add a `Procfile` with `web: python main.py` — the name is irrelevant;
   no port is bound.)
5. Go to the service → **Variables** tab → add (individually, not as a file):

   ```
   BOT_TOKEN = ...
   SUPABASE_URL = ...
   SUPABASE_KEY = ...
   AI_KEYS = dahl=sk-...
   BOT_ACTIVE = true
   SCAN_INTERVAL_SEC = 60
   ```

   Tip: if you have many vars, keep them minimal — the bot has code defaults
   for everything except the 4 required ones (see `.env.example` MINIMAL block).
6. Railway restarts the service automatically on each code push.

### 3.2 Deploy via CLI (alternative)

```bash
npm i -g @railway/cli
railway login
railway init          # link to a new/existing project
railway up            # deploy current directory
railway variables --set "BOT_TOKEN=xxx" "SUPABASE_URL=xxx" "SUPABASE_KEY=xxx"
railway logs
```

### 3.3 Railway checklist

- ✅ Service is **always-on** (not a cron / serverless template).
- ✅ Do **not** enable a public domain — the bot polls Telegram outbound.
- ✅ Watch **Metrics → Memory** — should stay < 200 MB.
- ⚠️ Railway's free trial has limited hours; a paid Hobby plan (~$5/mo) keeps
  it running 24/7.

---

## 4) After deployment — go-live checklist

1. `journalctl -f` / `docker logs -f` / `railway logs` → no tracebacks.
2. Telegram: `/start` → menu appears.
3. Add the bot as **admin** of your channel (needs *Delete messages*).
4. `/channel` → `@yourchannel` (must show "connected").
5. `/scan` → drafts appear.
6. `/auto off` → `/review` → publish one test post ✅.
7. `/published` → delete the test post 🗑 (verifies admin rights).
8. When satisfied: `/auto on` — posts now publish automatically.

## 5) Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` on start | Wrong `BOT_TOKEN` | Re-check BotFather token, no spaces |
| `403 / 404` from Supabase | Wrong URL or key | Use `service_role` key, no trailing `/` in URL |
| Bot replies but never scans | `BOT_ACTIVE=false` or `/bot off` | `/bot on`, check `BOT_ACTIVE=true` |
| No drafts after `/scan` | All feeds dead or filtered | `/sourcescheck`, `/togglesource` |
| 409 Conflict in logs | Same token running twice | Stop the old process/host before starting the new one |
| AI always fails | Key empty/expired | `/aicheck`, then `/keys`; set `AI_KEYS` again |
| systemd shows `status=203` | Bad `ExecStart` path | Verify venv python path & `WorkingDirectory` |
| Railway restart loop | Missing required env var | Check logs; all 4 required vars set? |

## 6) Security notes (all platforms)

- Secrets only via platform env/secret mechanism — never in code or git.
- Keep the Supabase `service_role` key on the server only.
- `chmod 600 .env` on VPS; `.dockerignore` the env file when building images.
- If a key leaks: revoke it at the provider (BotFather `/revoke`, Supabase
  dashboard, DeepSeek console) and redeploy with the new value.
- Keep the OS patched: `sudo apt update && sudo apt upgrade -y` monthly.

---

# 🇮🇷 راهنمای سریع فارسی

## ۱) VPS + systemd (پیشنهادی)

```bash
# روی سرور اوبونتو:
adduser newsbot && su - newsbot
sudo apt update && sudo apt install -y python3-venv git
cd /opt && sudo mkdir newschannelbot && sudo chown newsbot:newsbot newschannelbot
cd newschannelbot && git clone https://github.com/mohsen-niksirat/News-Channel-Bot.git .
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env && nano .env && chmod 600 .env
python main.py        # تست؛ بعد Ctrl+C
```

فایل سرویس `/etc/systemd/system/newschannelbot.service`:

```ini
[Unit]
Description=NewsChannelBot - Telegram news bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=newsbot
WorkingDirectory=/opt/newschannelbot
EnvironmentFile=/opt/newschannelbot/.env
ExecStart=/opt/newschannelbot/.venv/bin/python /opt/newschannelbot/main.py
Restart=always
RestartSec=10
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now newschannelbot
journalctl -u newschannelbot -f     # لاگ زنده
```

آپدیت: `git pull` → `pip install -r requirements.txt` → `sudo systemctl restart newschannelbot`

## ۲) Docker

فایل‌های `Dockerfile` و `docker-compose.yml` بالا را بسازید، سپس:

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose logs -f
```

## ۳) Deployka / Railway (بدون سرور)

**Deployka** (پیشنهادی — نسخه رایگان ۱۲۸ مگ رم دارد، برای این بات کافی است):

1. ثبت‌نام در [deployka.dev](https://deployka.dev/)
2. سرویس Python جدید → اتصال همین ریپوی گیت‌هاب (یا آپلود `main.py`, `sources_defaults.py`, `requirements.txt`)
3. در بخش Environment فقط ۴ متغیر اجباری: `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, `AI_KEYS`
4. Start Command: `python main.py`
5. سرویس همیشه روشن باشد؛ لاگ‌ها را از پنل ببینید

💡 کل مراحل فنی را می‌توانید به ایجنت هوش مصنوعی بسپارید (Freebuff، OpenCode، Xiaomi MiMo AI و…):
شما فقط در Supabase و Deployka ثبت‌نام کنید و آدرس ریپو + ۴ مقدار را به ایجنت بدهید؛
بقیه کارها (کلون، نصب، ساخت `.env`، رفع خطا) با ایجنت است.

**Railway:** ریپو را وصل کنید → Start Command: `python main.py` → متغیرها در تب Variables.

## چک‌لیست راه‌اندازی نهایی

بات را ادمین کانال کنید → `/channel` → `@کانال` → `/scan` → اول با `/auto off` دستی بررسی کنید → بعد `/auto on`

## امنیت

- هرگز `.env` را در گیت یا داکرفایل نگذارید
- کلید Supabase از نوع `service_role` باشد و فقط سمت سرور بماند
- اگر کلیدی لو رفت، همان لحظه در پنل ارائه‌دهنده باطل (revoke) کنید

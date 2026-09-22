# News sources (RSS)

Verify a feed in the browser before production. If a URL 404s, disable it in the bot (`/sources`) or edit `sources_defaults.py`.

## International (EN / other) — translate to Persian via DeepSeek

| Name | Category | URL | Notes |
|------|----------|-----|-------|
| BBC World | world | `https://feeds.bbci.co.uk/news/world/rss.xml` | Very stable RSS |
| BBC Technology | tech | `https://feeds.bbci.co.uk/news/technology/rss.xml` | |
| Al Jazeera English | world | `https://www.aljazeera.com/xml/rss/all.xml` | Verified live |
| The Guardian World | world | `https://www.theguardian.com/world/rss` | |
| The Guardian Tech | tech | `https://www.theguardian.com/technology/rss` | |
| DW News | world | `https://rss.dw.com/rdf/rss-en-all` | |
| France 24 English | world | `https://www.france24.com/en/rss` | |
| Sky News | world | `https://feeds.skynews.com/feeds/rss/home.xml` | |
| NPR World | world | `https://feeds.npr.org/1004/rss.xml` | |
| AP News Top | world | `https://apnews.com/hub/ap-top-news?output=rss` | May change |
| The Verge | tech | `https://www.theverge.com/rss/index.xml` | |
| TechCrunch | tech | `https://techcrunch.com/feed/` | |
| Ars Technica | tech | `https://feeds.arstechnica.com/arstechnica/index` | |
| Hacker News | tech | `https://hnrss.org/frontpage` | |
| NASA Breaking | science | `https://www.nasa.gov/rss/dyn/breaking_news.rss` | |

## Domestic / Persian (FA) — already Persian; short rewrite only

| Name | Category | URL | Notes |
|------|----------|-----|-------|
| ISNA | iran | `https://www.isna.ir/rss` | Verified live |
| Mehr News | iran | `https://www.mehrnews.com/rss` | |
| IRNA | iran | `https://www.irna.ir/rss` | |
| Khabaronline | iran | `https://www.khabaronline.ir/rss` | |
| Tabnak | iran | `https://www.tabnak.ir/rss` | |
| Digiato | tech | `https://digiato.com/feed/` | Persian tech |
| Varzesh3 | sports | `https://www.varzesh3.com/rss` | |
| Euronews Persian | world | `https://fa.euronews.com/rss` | |

## Optional: public Telegram channels as sources (later phase)

You can also monitor `https://t.me/s/<username>` HTML (same idea as tgexplorer crawler). Not wired in Phase 1 — RSS only.

## Legal / ethics

- Always put **source name + link** on every post.
- Summarize / rewrite; do not republish full articles.
- Respect site ToS; prefer official RSS over heavy scraping.

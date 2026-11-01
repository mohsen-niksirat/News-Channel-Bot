import { db } from 'sdk';
import { addSource, getUser } from 'lib/db';

const NEW_SOURCES = [
  {
    name: "MIT Technology Review (AI)",
    type: "rss",
    urlOrHandle: "https://www.technologyreview.com/feed/",
    lang: "en",
    category: "tech"
  },
  {
    name: "Ars Technica",
    type: "rss",
    urlOrHandle: "https://feeds.arstechnica.com/arstechnica/index",
    lang: "en",
    category: "tech"
  },
  {
    name: "Wired",
    type: "rss",
    urlOrHandle: "https://www.wired.com/feed/rss",
    lang: "en",
    category: "tech"
  },
  {
    name: "دیجیاتو (وب‌سایت)",
    type: "rss",
    urlOrHandle: "https://digiato.com/feed",
    lang: "fa",
    category: "tech"
  },
  {
    name: "زومیت (وب‌سایت)",
    type: "rss",
    urlOrHandle: "https://zoomit.ir/feed/",
    lang: "fa",
    category: "tech"
  },
  {
    name: "@Digiato (کانال دیجیاتو)",
    type: "telegram",
    urlOrHandle: "@Digiato",
    lang: "fa",
    category: "tech"
  },
  {
    name: "@ai_python (کانال تخصصی هوش مصنوعی)",
    type: "telegram",
    urlOrHandle: "@ai_python",
    lang: "fa",
    category: "tech"
  },
  {
    name: "@AiNewsChannel (کانال اخبار AI)",
    type: "telegram",
    urlOrHandle: "@AiNewsChannel",
    lang: "fa",
    category: "tech"
  },
  {
    name: "@Zoomit (کانال زومیت)",
    type: "telegram",
    urlOrHandle: "@Zoomit",
    lang: "fa",
    category: "tech"
  }
];

export default async function (input, ctx) {
  const userId = input?.userId || 65807806;
  const sourcesToAdd = (input?.sources && input.sources.length > 0) ? input.sources : NEW_SOURCES;
  const results = [];

  for (const s of sourcesToAdd) {
    try {
      const added = await addSource(userId, {
        name: s.name,
        type: s.type || 'rss',
        urlOrHandle: s.urlOrHandle,
        lang: s.lang || 'fa',
        category: s.category || 'tech',
      });
      results.push({ ok: true, name: s.name, id: added?.id });
    } catch (err) {
      results.push({ ok: false, name: s.name, error: err.message });
    }
  }

  return { ok: true, count: results.length, results };
}

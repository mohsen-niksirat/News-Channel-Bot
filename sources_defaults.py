# Default global RSS sources — edit this list to change what every user starts with.
# user_id is None → global. Users can later enable/disable via bot (Phase 2 UI).

DEFAULT_SOURCES = [
    # --- International: translated to Persian ---
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

    # --- Domestic / Persian: short rewrite only ---
    {"name": "ISNA", "url": "https://www.isna.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Mehr News", "url": "https://www.mehrnews.com/rss", "lang": "fa", "category": "iran"},
    {"name": "IRNA", "url": "https://www.irna.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Khabaronline", "url": "https://www.khabaronline.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Tabnak", "url": "https://www.tabnak.ir/rss", "lang": "fa", "category": "iran"},
    {"name": "Digiato", "url": "https://digiato.com/feed/", "lang": "fa", "category": "tech"},
    {"name": "Varzesh3", "url": "https://www.varzesh3.com/rss/all", "lang": "fa", "category": "sports"},
]

import { table, integer, text, boolean, index, sql } from 'sdk/db';

export const users = table('users', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  tgId:                integer('tg_id').unique().notNull(),
  name:                text('name'),
  username:            text('username'),
  channelId:           text('channel_id'),        // e.g. "@MyLeitner" or "-100..."
  channelTitle:        text('channel_title'),
  autoPublish:         boolean('auto_publish').default(false), // true = instant publish, false = review queue
  publishMode:         text('publish_mode').default('smart'),  // 'smart' | 'individual' | 'bulletin'
  preferredAiProvider: text('preferred_ai_provider').default('gemini'),
  preferredModel:      text('preferred_model').default('gemini-1.5-flash'),
  routingPolicy:       text('routing_policy').default('fallback'), // 'fallback' | 'round_robin' | 'smart_router' | 'fusion'
  footerText:          text('footer_text').default('📢 @MyLeitner'),
  expandableQuotes:    boolean('expandable_quotes').default(true), // Use Bot API 10.3 expandable blockquotes
  toneProfile:         text('tone_profile').default('standard'),
  toneCustom:          text('tone_custom'),
  scheduleWindows:     text('schedule_windows'),
  state:               text('state').default('idle'),
  stateData:           text('state_data'),
  postsPublishedCount: integer('posts_published_count').default(0),
  createdAt:           integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  tgIdx: index('idx_users_tg').on(t.tgId),
}));

export const sources = table('sources', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  userId:        integer('user_id'),             // null = default global sources
  name:          text('name').notNull(),         // e.g. "Zoomit"
  type:          text('type').notNull(),         // 'telegram' or 'rss'
  urlOrHandle:   text('url_or_handle').notNull(),// '@digiato' or 'https://zoomit.ir/feed/'
  lang:          text('lang').default('fa'),     // 'fa' or 'en'
  category:      text('category').default('tech'),
  categories:    text('categories'),
  enabled:       boolean('enabled').default(true),
  lastScannedAt: integer('last_scanned_at'),
  createdAt:     integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  userSrcIdx: index('idx_sources_user').on(t.userId),
}));

export const customProviders = table('custom_providers', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  userId:       integer('user_id'),
  name:         text('name').notNull(),
  slug:         text('slug').notNull(),         // e.g. "c_1"
  baseUrl:      text('base_url').notNull(),     // e.g. "https://api.openai.com/v1"
  defaultModel: text('default_model'),
  models:       text('models'),                 // JSON array string of model names
  createdAt:    integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  userProvIdx: index('idx_custom_prov_user').on(t.userId),
}));

export const aiKeys = table('ai_keys', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  userId:        integer('user_id'),             // null = admin/system keys
  provider:      text('provider').notNull(),     // 'gemini' | 'groq' | 'deepseek' | 'openai' | 'openrouter' | 'c_1' etc.
  apiKey:        text('api_key').notNull(),
  label:         text('label'),
  baseUrl:       text('base_url'),               // For custom or proxies
  status:        text('status').default('active'), // 'active' | 'cooldown' | 'dead'
  failureCount:  integer('failure_count').default(0),
  cooldownUntil: integer('cooldown_until').default(0),
  sortOrder:     integer('sort_order').default(0), // Ordering priority (lower = higher priority)
  totalTokens:   integer('total_tokens').default(0),
  lastUsedAt:    integer('last_used_at'),
  createdAt:     integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  provIdx:  index('idx_keys_provider').on(t.provider, t.status),
  orderIdx: index('idx_keys_order').on(t.sortOrder),
}));

export const tokenUsage = table('token_usage', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  userId:           integer('user_id').notNull(),
  keyId:            integer('key_id'),
  provider:         text('provider').notNull(),
  model:            text('model'),
  promptTokens:     integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  totalTokens:      integer('total_tokens').default(0),
  action:           text('action').default('news_rewrite'),
  createdAt:        integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  userUsageIdx: index('idx_usage_user_time').on(t.userId, t.createdAt),
}));

export const posts = table('posts', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  userId:             integer('user_id').notNull(),
  sourceName:         text('source_name'),
  sourceUrl:          text('source_url'),
  originalTitle:      text('original_title'),
  originalHash:       text('original_hash').notNull(), // Hash of title/link to deduplicate
  aiTitle:            text('ai_title'),
  aiSummary:          text('ai_summary'),
  formattedHtml:      text('formatted_html'),
  imageUrl:           text('image_url'),
  category:           text('category'),
  importance:         integer('importance'),
  status:             text('status').default('draft'), // 'draft' | 'published' | 'rejected'
  publishedMessageId: integer('published_message_id'),
  publishedAt:        integer('published_at'),
  createdAt:          integer('created_at').default(sql`(unixepoch())`),
}, (t) => ({
  hashIdx:   index('idx_posts_hash').on(t.userId, t.originalHash),
  statusIdx: index('idx_posts_status').on(t.userId, t.status),
}));

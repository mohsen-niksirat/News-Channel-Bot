-- NewsChannelBot schema — run in Supabase SQL Editor (order matters)

-- Users of the bot (each can bind one channel)
create table if not exists bot_users (
  telegram_id bigint primary key,
  username text,
  full_name text,
  auto_publish boolean not null default false,
  channel_id bigint,
  channel_username text,
  channel_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RSS / news sources (user_id null = global default available to all)
create table if not exists sources (
  id bigserial primary key,
  user_id bigint references bot_users(telegram_id) on delete cascade,
  name text not null,
  url text not null,
  lang text not null default 'en',          -- en | fa | ar | ...
  category text not null default 'world',   -- world | tech | economy | iran | sports
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

-- Fetched raw articles (global pool, deduped by url hash)
create table if not exists articles (
  id bigserial primary key,
  source_id bigint references sources(id) on delete set null,
  guid text not null,
  url text not null,
  title text not null,
  summary text,
  source_lang text,
  source_name text,
  category text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (guid)
);

-- Per-user drafts + publish state
create table if not exists drafts (
  id bigserial primary key,
  user_id bigint not null references bot_users(telegram_id) on delete cascade,
  article_id bigint not null references articles(id) on delete cascade,
  fa_text text,
  status text not null default 'pending',
    -- pending | waiting_review | approved | published | rejected | failed
  published_message_id bigint,
  published_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create index if not exists idx_drafts_user_status on drafts (user_id, status);
create index if not exists idx_articles_guid on articles (guid);
create index if not exists idx_sources_enabled on sources (enabled);

-- Optional: allow public read of global sources via anon key (not required for bot)
-- alter table sources enable row level security;

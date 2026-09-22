-- Migration 07: news filters (block/blocklist/keyword)
-- Run in Supabase SQL Editor AFTER 01..06
-- Allows users to define custom filters for incoming articles:
--   - block_category: block articles of a given category (e.g. 'sports')
--   - block_keyword: block articles whose title/summary contain a keyword
--   - only_keyword: only allow articles matching at least one keyword (whitelist)
--   - min_score: only allow articles with AI relevance score >= this (future AI scoring)

create table if not exists article_filters (
  id bigserial primary key,
  user_id bigint not null references bot_users(telegram_id) on delete cascade,
  filter_name text not null,              -- user-friendly label
  filter_type text not null,              -- block_category | block_keyword | only_keyword | block_source
  match_value text not null,              -- the category, keyword, or source name
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, filter_type, match_value)
);

create index if not exists idx_filters_user on article_filters (user_id, enabled);

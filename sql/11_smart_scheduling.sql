-- Migration 11: Smart content scheduling + fun content support
-- Run AFTER 10_hourly_limit.sql in Supabase SQL Editor
--
-- Features:
-- 1. Per-user scheduling preferences (optimal publish times)
-- 2. Content type tagging (serious news vs fun/entertainment)
-- 3. Smart scheduling algorithm configuration
-- 4. Fun content source types (social media posts, meme channels)

-- User scheduling preferences
alter table bot_users add column if not exists smart_schedule_enabled boolean default true;
alter table bot_users add column if not exists preferred_publish_hours text default '08,12,18,21'; -- Iran time slots (hour list, 0-23)
alter table bot_users add column if not exists content_mix jsonb default '{"serious": 0.8, "fun": 0.2}'; -- content mix ratio
alter table bot_users add column if not includes_fun_content boolean default true;
alter table bot_users add column if not exists min_posts_per_hour integer default 2;
alter table bot_users add column if not exists max_posts_per_hour integer default 6;

-- Content type tagging in articles
alter table articles add column if not exists content_type text default 'news';
-- 'news' | 'fun' | 'entertainment' | 'meme'

-- Indexes for performance
create index if not exists idx_articles_content_type on articles (content_type);
create index if not exists idx_bot_users_smart_schedule on bot_users (smart_schedule_enabled);

-- Fun content sources (social media, meme channels)
-- Users can add their own fun content sources via /addsite with type 'fun'
-- Example: /addsite "فان و سرگرمی" | https://t.me/your_fan_channel | fun | fa | telegram_fun
alter table sources add column if not exists is_fun_source boolean default false;
create index if not exists idx_sources_is_fun on sources (is_fun_source, enabled);

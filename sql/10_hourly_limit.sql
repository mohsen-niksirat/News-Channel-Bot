-- Migration 10: hourly post limit per user/channel
-- Run AFTER 04_digest.sql in Supabase SQL Editor
-- Allows users to set a max posts per hour. When limit is reached, 
-- unread articles are queued and summed up at the end of the hour.

alter table bot_users add column if not exists max_posts_per_hour integer default 0; -- 0 = unlimited
alter table bot_users add column if not exists hourly_posts_count integer default 0; -- current hour count
alter table bot_users add column if not exists hourly_reset_at timestamptz; -- when counter resets

-- Queue for hourly summaries (stores fa_text before publishing when limit reached)
create table if not exists hourly_queue (
  id bigserial primary key,
  user_id bigint not null references bot_users(telegram_id) on delete cascade,
  article_id bigint not null references articles(id) on delete cascade,
  fa_text text,
  queued_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create index if not exists idx_hourly_queue_user on hourly_queue (user_id);
create index if not exists idx_hourly_queue_queued_at on hourly_queue (queued_at);
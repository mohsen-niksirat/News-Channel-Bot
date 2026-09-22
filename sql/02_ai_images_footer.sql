-- Migration: AI provider + images + channel footer
-- Run AFTER 01_init.sql in Supabase SQL Editor

alter table bot_users add column if not exists ai_provider text default 'deepseek';
alter table bot_users add column if not exists ai_model text;
alter table bot_users add column if not exists channel_footer text;

alter table articles add column if not exists images jsonb default '[]'::jsonb;

-- Optional: unique images helper index
create index if not exists idx_articles_images on articles using gin (images);

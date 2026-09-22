-- Migration 03: discussion group + full post text
-- Run in Supabase SQL Editor AFTER 02_ai_images_footer.sql

alter table bot_users add column if not exists discussion_chat_id bigint;
alter table bot_users add column if not exists discussion_username text;

alter table drafts add column if not exists full_text text;

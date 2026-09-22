-- Migration 06: source_type + social_handle + bot status
-- Run in Supabase SQL Editor AFTER 01..05
-- Adds support for Twitter/X, Instagram, and other social media sources
-- Also adds an owner-level bot_active flag (for /bot on/off via admin panel)

-- Source type: rss (default) | twitter | instagram | youtube_rss | etc.
alter table sources add column if not exists source_type text not null default 'rss';
alter table sources add column if not exists social_handle text;

-- Indexes for performance
create index if not exists idx_sources_type on sources (source_type);
create index if not exists idx_sources_enabled_type on sources (enabled, source_type);

-- Bot-level active flag (optional, for admin panel toggle)
-- If you want a per-instance on/off stored in Supabase, uncomment:
-- alter table bot_users add column if not exists bot_active boolean default true;

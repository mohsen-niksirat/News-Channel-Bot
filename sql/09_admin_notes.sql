-- Migration 09: admin_note column
-- Run in Supabase SQL Editor AFTER 01..08
-- Stores an optional editor/admin note text that gets inserted into
-- the published post before the source link.

alter table drafts add column if not exists admin_note text;

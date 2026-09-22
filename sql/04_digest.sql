-- Migration 04: periodic digest (round-up) settings
-- Run in Supabase SQL Editor AFTER 01, 02, 03

alter table bot_users add column if not exists digest_enabled boolean default true;
alter table bot_users add column if not exists digest_interval_hours integer default 12;
alter table bot_users add column if not exists digest_last_at timestamptz;

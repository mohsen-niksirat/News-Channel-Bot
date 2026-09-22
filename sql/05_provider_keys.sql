-- Migration 05: dynamic AI key pool (add many keys per provider from the bot)
-- Run in Supabase SQL Editor AFTER 01..04

create table if not exists provider_keys (
  id bigserial primary key,
  provider text not null,            -- xkiro | inception | vyce | dahl | deepseek
  api_key text not null,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, api_key)
);

create index if not exists idx_provider_keys_enabled on provider_keys (enabled);

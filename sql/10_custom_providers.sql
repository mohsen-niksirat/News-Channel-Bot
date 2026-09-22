-- Migration 10: Custom AI providers + dynamic API keys
-- Run in Supabase SQL Editor AFTER 01..09
-- Allows users (or global admin) to add their own OpenAI-compatible providers
-- with custom base URLs and models. Full lifecycle: add/edit/test/delete keys
-- and priority-based key selection.

create table if not exists custom_providers (
  id bigserial primary key,
  user_id bigint references bot_users(telegram_id) on delete cascade,  -- NULL for global/system
  name text not null,                              -- e.g. "MyOpenAI", "LocalLLaMA"
  base_url text not null,                          -- e.g. "https://api.openai.com/v1"
  default_model text,                              -- e.g. "gpt-4o"
  is_public boolean default false,                 -- true = shared with all users
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists provider_api_keys (
  id bigserial primary key,
  user_id bigint references bot_users(telegram_id) on delete cascade,
  provider_id bigint references custom_providers(id) on delete cascade,
  provider_key text,                               -- for global providers like 'deepseek', 'dahl', null for custom
  api_key text not null,
  label text,
  priority integer default 0,                      -- 0 = round-robin; >0 = prefer higher priority
  last_tested timestamptz,
  is_active boolean default true,
  health_status text default 'unknown',            -- 'ok' | 'error' | 'rate_limited' | 'unknown'
  created_at timestamptz not null default now(),
  unique (user_id, provider_id, api_key),
  unique (user_id, provider_key, api_key)
);

create index if not exists idx_provider_keys_user on provider_api_keys (user_id);
create index if not exists idx_provider_keys_health on provider_api_keys (health_status);
create index if not exists idx_custom_providers_name on custom_providers (name);

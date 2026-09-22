-- Migration 08: user feedback for AI learning
-- Run in Supabase SQL Editor AFTER 01..07
-- Stores user feedback on published articles (like/dislike)
-- Can be used to train a preference model or fine-tune filters

create table if not exists user_article_feedback (
  id bigserial primary key,
  user_id bigint not null references bot_users(telegram_id) on delete cascade,
  article_id bigint references articles(id) on delete set null,
  draft_id bigint references drafts(id) on delete set null,
  feedback text not null,                    -- 'like' | 'dislike' | 'skip' | 'share'
  created_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create index if not exists idx_feedback_user on user_article_feedback (user_id);
create index if not exists idx_feedback_article on user_article_feedback (article_id);

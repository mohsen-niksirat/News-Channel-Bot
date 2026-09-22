-- AskMyPdfBot schema (Supabase SQL Editor)
-- Run AFTER 00_enable_pgvector.sql

-- ============ users ============
create table if not exists bot_users (
  tg_id          bigint primary key,
  first_name     text,
  created_at     timestamptz default now(),
  last_seen_at   timestamptz default now()
);

-- ============ documents ============
create table if not exists docs (
  id            bigint generated always as identity primary key,
  user_tg_id    bigint references bot_users(tg_id) on delete cascade,
  name          text not null,
  n_pages       int default 0,
  n_chunks      int default 0,
  status        text default 'processing',   -- processing | ready | failed
  error         text,
  created_at    timestamptz default now()
);
create index if not exists docs_user_idx on docs(user_tg_id);

-- ============ chunks (pgvector) ============
-- dimension must match the embedding model! 1536 for many OpenAI-compatible
-- embedding endpoints; if you use another model, run:
--   alter table chunks alter column embedding type vector(<dim>);
create table if not exists chunks (
  id          bigint generated always as identity primary key,
  doc_id      bigint references docs(id) on delete cascade,
  user_tg_id  bigint references bot_users(tg_id) on delete cascade,
  chunk_no    int not null default 0,
  content     text not null,
  embedding   vector(1536) not null,
  created_at  timestamptz default now()
);
create index if not exists chunks_doc_idx on chunks(doc_id);
create index if not exists chunks_user_idx on chunks(user_tg_id);
-- cosine similarity index (ivfflat needs data to be effective; fine at small scale)
create index if not exists chunks_embedding_idx on chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============ daily usage / quota ============
create table if not exists daily_usage (
  user_tg_id  bigint,
  day         date not null default current_date,
  uploads     int default 0,
  questions   int default 0,
  primary key (user_tg_id, day)
);

-- ============ RPC: nearest chunks for one user ============
-- Security: service_role key bypasses RLS; bot always passes its own user_tg_id.
create or replace function match_chunks(
  p_user      bigint,
  p_embedding vector(1536),
  p_k         int default 6
)
returns table (
  chunk_id    bigint,
  doc_id      bigint,
  doc_name    text,
  chunk_no    int,
  content     text,
  similarity  float
)
language sql stable as $$
  select c.id,
         c.doc_id,
         d.name,
         c.chunk_no,
         c.content,
         1 - (c.embedding <=> p_embedding) as similarity
  from chunks c
  join docs d on d.id = c.doc_id
  where c.user_tg_id = p_user
    and d.status = 'ready'
  order by c.embedding <=> p_embedding
  limit p_k;
$$;

-- ============ heartbeat (keeps the free Supabase project active) ============
create table if not exists heartbeat (
  id     int primary key default 1,
  ts     timestamptz default now()
);
insert into heartbeat(id) values (1) on conflict (id) do nothing;

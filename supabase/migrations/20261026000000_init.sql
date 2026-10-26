-- Game Day Bingo: events and researched squares.
-- Run this once in the Supabase SQL editor (or with `supabase db push`).

create table if not exists public.events (
  id              text primary key,                -- e.g. 'nfl-12345' (sport + schedule provider id)
  sport           text not null check (sport in ('nfl', 'nba', 'nhl', 'mlb')),
  provider_id     text not null,
  starts_at       timestamptz not null,
  status_state    text,
  home_name       text not null,
  home_city       text,
  home_abbr       text,
  home_full       text,
  away_name       text not null,
  away_city       text,
  away_abbr       text,
  away_full       text,
  venue_name      text,
  venue_city      text,
  week            int,
  postseason      boolean not null default false,

  -- Research written by Claude, shared by everyone who picks this event.
  squares_status  text not null default 'none' check (squares_status in ('none', 'pending', 'ready', 'failed')),
  squares         jsonb,          -- [{text, tier, category, team}]
  facts           jsonb,          -- [{label, value}]
  sources         jsonb,          -- [{title, url}]
  generated_at    timestamptz,
  pending_since   timestamptz,
  refresh_count   int not null default 0,
  error           text,
  updated_at      timestamptz not null default now()
);

create index if not exists events_starts_at_idx on public.events (starts_at);

-- One row per research run, for rate limits and cost tracking.
create table if not exists public.generation_log (
  id          bigint generated always as identity primary key,
  event_id    text not null references public.events (id) on delete cascade,
  user_id     uuid not null,
  outcome     text not null,           -- 'ready' | 'failed'
  searches    int,
  input_tokens  int,
  output_tokens int,
  created_at  timestamptz not null default now()
);

create index if not exists generation_log_user_idx on public.generation_log (user_id, created_at);
create index if not exists generation_log_created_idx on public.generation_log (created_at);

-- Row-level security: anyone may read the schedule and squares; only the
-- Edge Functions (service role, which bypasses RLS) may write.
alter table public.events enable row level security;
alter table public.generation_log enable row level security;

drop policy if exists "Events are readable by everyone" on public.events;
create policy "Events are readable by everyone"
  on public.events for select
  to anon, authenticated
  using (true);

-- generation_log has no policies, so browsers can neither read nor write it.

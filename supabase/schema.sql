-- KLINSMD 4 PRO IV
-- Run this entire script in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  session_name text not null unique,
  display_name text not null,
  target_gender text not null check (target_gender in ('girl','boy')),
  code_hash text not null,
  recovery_hash text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  preferences jsonb not null default '{"language":"AUTO","mode":"AUTO"}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_token_hash_idx
  on public.conversations(token_hash);
create index if not exists conversations_updated_at_idx
  on public.conversations(updated_at desc);

-- All access goes through the Express API using the server-only Supabase secret key.
-- No browser role can read or modify conversation records.
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
drop policy if exists "No direct browser access" on public.conversations;
create policy "No direct browser access"
  on public.conversations for all
  to anon, authenticated
  using (false) with check (false);


-- Persistent recovery throttling: five attempts per IP/session key per 15 minutes.
create table if not exists public.recovery_attempts (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.recovery_attempts enable row level security;
revoke all on public.recovery_attempts from anon, authenticated;

create or replace function public.consume_recovery_attempt(
  p_key text,
  p_window_seconds integer default 900,
  p_max_attempts integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempts integer;
begin
  insert into public.recovery_attempts(rate_key, window_started_at, attempts)
  values (p_key, now(), 1)
  on conflict (rate_key) do update
    set window_started_at = case
          when public.recovery_attempts.window_started_at <
               now() - make_interval(secs => p_window_seconds)
          then now()
          else public.recovery_attempts.window_started_at
        end,
        attempts = case
          when public.recovery_attempts.window_started_at <
               now() - make_interval(secs => p_window_seconds)
          then 1
          else public.recovery_attempts.attempts + 1
        end
  returning attempts into current_attempts;

  return current_attempts <= p_max_attempts;
end;
$$;

revoke all on function public.consume_recovery_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_recovery_attempt(text, integer, integer) to service_role;

-- Remove expired recovery throttling records periodically if desired:
-- delete from public.recovery_attempts where window_started_at < now() - interval '2 days';

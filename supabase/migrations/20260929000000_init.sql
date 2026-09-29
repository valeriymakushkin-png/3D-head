-- ============================================================================
-- TwinMe AI — initial schema
-- Postgres 15 (Supabase). All access goes through the Next.js BFF with the
-- service role; RLS is enabled everywhere as defence in depth (anon has no
-- policies = no access; `authenticated` policies are ready for direct client
-- access once Supabase-issued JWTs carry sub = users.id).
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type plan_tier as enum ('free', 'pro', 'barber', 'clinic');
create type subscription_status as enum ('none', 'trialing', 'active', 'past_due', 'canceled');
create type avatar_status as enum ('uploading', 'queued', 'processing', 'ready', 'failed');
create type avatar_tier as enum ('instant', 'hd');
create type transformation_type as enum ('hairstyle', 'beard', 'hair_color', 'glasses', 'skin', 'accessories', 'look', 'glow_up', 'stylist');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');
create type billing_provider as enum ('stripe', 'telegram_stars');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Users
-- `plan` / `subscription_status` are a denormalised cache of `subscriptions`
-- maintained by refresh_user_plan(); reads never join subscriptions.
-- ---------------------------------------------------------------------------
create table users (
  id                  uuid primary key default gen_random_uuid(),
  telegram_id         bigint unique,
  email               citext unique,
  display_name        text check (char_length(display_name) <= 120),
  photo_url           text,
  locale              text check (char_length(locale) <= 16),
  is_anonymous        boolean not null default false,
  plan                plan_tier not null default 'free',
  subscription_status subscription_status not null default 'none',
  stripe_customer_id  text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger users_updated before update on users for each row execute function set_updated_at();
create index users_anon_gc on users (created_at) where is_anonymous;

-- ---------------------------------------------------------------------------
-- Avatars (digital twins)
-- Instant twins live on-device; a row exists only when the user syncs one or
-- orders an HD twin. model_url / thumbnail are storage object paths.
-- ---------------------------------------------------------------------------
create table avatars (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  tier          avatar_tier not null,
  status        avatar_status not null default 'uploading',
  model_url     text,
  thumbnail     text,
  rig           jsonb,
  analysis      jsonb,
  natural_hair  jsonb,
  source        text check (source in ('photos', 'video', 'guided')),
  capture_count int not null default 0 check (capture_count between 0 and 40),
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger avatars_updated before update on avatars for each row execute function set_updated_at();
create index avatars_by_user on avatars (user_id, created_at desc) where deleted_at is null;

-- Raw photos for HD reconstruction. Purged 24 h after upload (privacy promise).
create table captures (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid not null references avatars (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  storage_path text not null unique,
  kind         text not null check (kind in ('photo', 'video')),
  pose         jsonb,
  created_at   timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '24 hours',
  purged_at    timestamptz
);
create index captures_by_avatar on captures (avatar_id);
create index captures_to_purge on captures (purge_after) where purged_at is null;

-- ---------------------------------------------------------------------------
-- Reconstruction queue (GPU worker claims with SKIP LOCKED)
-- ---------------------------------------------------------------------------
create table reconstruction_jobs (
  id           uuid primary key default gen_random_uuid(),
  avatar_id    uuid not null unique references avatars (id) on delete cascade,
  status       job_status not null default 'queued',
  priority     smallint not null default 0,
  attempts     int not null default 0,
  max_attempts int not null default 3,
  worker_id    text,
  locked_at    timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text,
  metrics      jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger jobs_updated before update on reconstruction_jobs for each row execute function set_updated_at();
create index jobs_claimable on reconstruction_jobs (priority desc, created_at) where status = 'queued';

create or replace function claim_reconstruction_job(p_worker text)
returns setof reconstruction_jobs
language plpgsql as $$
begin
  return query
  update reconstruction_jobs j
     set status = 'running', worker_id = p_worker, locked_at = now(),
         started_at = coalesce(j.started_at, now()), attempts = j.attempts + 1
   where j.id = (
     select id from reconstruction_jobs
      where (status = 'queued')
         or (status = 'running' and locked_at < now() - interval '15 minutes' and attempts < max_attempts)
      order by priority desc, created_at
      for update skip locked
      limit 1)
  returning j.*;
end $$;

create or replace function heartbeat_reconstruction_job(p_job uuid, p_worker text)
returns void language sql as $$
  update reconstruction_jobs set locked_at = now() where id = p_job and worker_id = p_worker and status = 'running';
$$;

-- ---------------------------------------------------------------------------
-- Transformations: saved looks + the metering ledger for the free tier.
-- ---------------------------------------------------------------------------
create table transformations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  avatar_id  uuid references avatars (id) on delete set null,
  type       transformation_type not null,
  source     text not null default 'manual' check (source in ('manual', 'stylist', 'glow_up')),
  settings   jsonb not null,
  metered    boolean not null default true,
  created_at timestamptz not null default now()
);
create index transformations_by_user on transformations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Subscriptions (Stripe on the web, Telegram Stars inside Telegram)
-- ---------------------------------------------------------------------------
create table subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users (id) on delete cascade,
  plan                     plan_tier not null check (plan <> 'free'),
  status                   subscription_status not null,
  provider                 billing_provider not null,
  provider_subscription_id text not null,
  provider_customer_id     text,
  current_period_start     timestamptz,
  expires_at               timestamptz not null,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create trigger subscriptions_updated before update on subscriptions for each row execute function set_updated_at();
create index subscriptions_by_user on subscriptions (user_id, expires_at desc);

-- Webhook idempotency: every provider event id is processed exactly once.
create table billing_events (
  id           text primary key,
  provider     billing_provider not null,
  type         text not null,
  payload      jsonb not null,
  processed_at timestamptz not null default now()
);

-- Recomputes the denormalised plan on users from live subscriptions.
create or replace function refresh_user_plan(p_user uuid) returns void
language plpgsql as $$
declare
  best record;
begin
  select plan, status into best
    from subscriptions
   where user_id = p_user and status in ('active', 'trialing', 'past_due') and expires_at > now()
   order by case plan when 'clinic' then 3 when 'barber' then 2 when 'pro' then 1 else 0 end desc
   limit 1;
  update users
     set plan = coalesce(best.plan, 'free'),
         subscription_status = coalesce(best.status, 'none')
   where id = p_user;
end $$;

-- Effective plan honours expiry even if a webhook was missed.
create or replace view user_entitlements as
select u.id as user_id,
       case when exists (select 1 from subscriptions s
                          where s.user_id = u.id and s.plan = u.plan
                            and s.status in ('active', 'trialing', 'past_due') and s.expires_at > now())
            then u.plan else 'free'::plan_tier end as plan
  from users u
 where u.deleted_at is null;

-- Atomically meters a transformation. Returns remaining free uses
-- (-1 = unlimited). Raises SQLSTATE 'P0402' when the free quota is spent.
create or replace function consume_transformation(
  p_user uuid, p_type transformation_type, p_avatar uuid, p_settings jsonb, p_source text, p_free_limit int
) returns int
language plpgsql as $$
declare
  v_plan plan_tier;
  v_used int;
begin
  perform 1 from users where id = p_user for update; -- serialise per user
  select plan into v_plan from user_entitlements where user_id = p_user;
  if v_plan is null then
    raise exception 'unknown user' using errcode = 'P0404';
  end if;
  if v_plan = 'free' then
    select count(*) into v_used from transformations where user_id = p_user and metered;
    if v_used >= p_free_limit then
      raise exception 'quota_exceeded' using errcode = 'P0402';
    end if;
  end if;
  insert into transformations (user_id, avatar_id, type, source, settings, metered)
  values (p_user, p_avatar, p_type, coalesce(p_source, 'manual'), coalesce(p_settings, '{}'::jsonb), v_plan = 'free');
  return case when v_plan = 'free' then p_free_limit - v_used - 1 else -1 end;
end $$;

-- Moves an anonymous user's data onto a signed-in account (first sign-in).
create or replace function merge_users(p_from uuid, p_into uuid) returns void
language plpgsql as $$
begin
  if p_from = p_into then return; end if;
  update avatars set user_id = p_into where user_id = p_from;
  update captures set user_id = p_into where user_id = p_from;
  update transformations set user_id = p_into where user_id = p_from;
  delete from users where id = p_from and is_anonymous;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window) — keeps abuse control inside Postgres, no Redis.
-- ---------------------------------------------------------------------------
create unlogged table rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
);

create or replace function hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql as $$
declare
  v_count int;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
     set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
         window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- AI cost ledger (per request) — for unit economics and abuse detection.
-- ---------------------------------------------------------------------------
create table ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references users (id) on delete set null,
  feature       text not null check (feature in ('stylist', 'glow_up')),
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cache_read    int not null default 0,
  created_at    timestamptz not null default now()
);
create index ai_usage_by_user on ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Professional plans: barbers & clinics
-- ---------------------------------------------------------------------------
create table clients (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  phone        text,
  notes        text check (char_length(notes) <= 4000),
  avatar_id    uuid references avatars (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger clients_updated before update on clients for each row execute function set_updated_at();
create index clients_by_owner on clients (owner_id, created_at desc) where deleted_at is null;

create table consultations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users (id) on delete cascade,
  client_id   uuid not null references clients (id) on delete cascade,
  looks       jsonb not null default '[]'::jsonb,
  chosen_look jsonb,
  notes       text,
  created_at  timestamptz not null default now()
);
create index consultations_by_client on consultations (client_id, created_at desc);

create table patient_reports (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users (id) on delete cascade,
  client_id      uuid not null references clients (id) on delete cascade,
  hairline       jsonb not null,
  graft_estimate int check (graft_estimate between 0 and 10000),
  pdf_path       text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log (security-relevant events only; no face data)
-- ---------------------------------------------------------------------------
create table audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  action     text not null,
  target     text,
  meta       jsonb,
  ip         inet,
  created_at timestamptz not null default now()
);
create index audit_by_user on audit_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table avatars enable row level security;
alter table captures enable row level security;
alter table reconstruction_jobs enable row level security;
alter table transformations enable row level security;
alter table subscriptions enable row level security;
alter table billing_events enable row level security;
alter table rate_limits enable row level security;
alter table ai_usage enable row level security;
alter table clients enable row level security;
alter table consultations enable row level security;
alter table patient_reports enable row level security;
alter table audit_log enable row level security;

create policy users_self on users for select to authenticated using (id = auth.uid());
create policy avatars_owner on avatars for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy transformations_owner on transformations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy subscriptions_owner on subscriptions for select to authenticated using (user_id = auth.uid());
create policy clients_owner on clients for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy consultations_owner on consultations for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy reports_owner on patient_reports for select to authenticated using (owner_id = auth.uid());
-- captures, jobs, billing_events, rate_limits, ai_usage, audit_log: service role only.

revoke all on function consume_transformation, hit_rate_limit, claim_reconstruction_job, heartbeat_reconstruction_job, merge_users, refresh_user_plan from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets (private; accessed only via short-lived signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('captures', 'captures', false, 26214400, array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('avatars', 'avatars', false, 52428800, array['model/gltf-binary', 'application/octet-stream', 'image/jpeg', 'image/webp', 'application/json']),
  ('thumbnails', 'thumbnails', false, 2097152, array['image/webp', 'image/jpeg', 'image/png']),
  ('reports', 'reports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

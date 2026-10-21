create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and enabled = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  client_name text not null,
  campaign_name text not null,
  token text not null,
  days_accumulated integer not null default 0 check (days_accumulated >= 0),
  total_impressions_accumulated bigint not null default 0 check (total_impressions_accumulated >= 0),
  status text not null default 'ativa' check (status in ('ativa', 'pausada', 'encerrada')),
  period text not null default '',
  month_year text,
  general_frequency text not null default '',
  report_summary text,
  client_theme jsonb not null default '{}'::jsonb,
  dashboard_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.points (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  address text,
  operating_hours text not null default '',
  local_frequency text not null default '',
  unique (campaign_id, name)
);

create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.points(id) on delete cascade,
  name text not null,
  daily_target integer check (daily_target is null or daily_target >= 0),
  status text not null default 'desconhecido'
    check (status in ('online', 'offline', 'desconhecido')),
  unique (point_id, name)
);

create table if not exists public.daily_screen_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  screen_id uuid not null references public.screens(id) on delete cascade,
  impressions_delivered bigint not null default 0 check (impressions_delivered >= 0),
  daily_target integer check (daily_target is null or daily_target >= 0),
  nominal_failure boolean not null default false,
  report_status text check (report_status is null or report_status in ('normal', 'alerta', 'zerado', 'desconhecido')),
  failure_note text,
  unique (report_date, screen_id)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text not null default '',
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('video/mp4', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.pdf_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  original_file_name text not null,
  storage_path text not null unique,
  status text not null default 'analisando'
    check (status in ('analisando', 'analisado', 'salvo', 'perfil_salvo', 'falhou')),
  report jsonb,
  ai_summary text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.private_settings (
  setting_key text primary key,
  secret_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.campaigns enable row level security;
alter table public.points enable row level security;
alter table public.screens enable row level security;
alter table public.daily_screen_reports enable row level security;
alter table public.videos enable row level security;
alter table public.pdf_reports enable row level security;
alter table public.private_settings enable row level security;

create policy "admin reads own access record"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'campaigns',
    'points',
    'screens',
    'daily_screen_reports',
    'videos',
    'pdf_reports'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      'admin manages ' || table_name,
      table_name
    );
  end loop;
end $$;

create or replace function public.get_public_client_report(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  campaign_row public.campaigns;
  response jsonb;
begin
  select * into campaign_row
  from public.campaigns
  where slug = p_slug;

  if campaign_row.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'campaign', to_jsonb(campaign_row) - 'token',
    'points', coalesce((
      select jsonb_agg(to_jsonb(p))
      from public.points p
      where p.campaign_id = campaign_row.id
    ), '[]'::jsonb),
    'screens', coalesce((
      select jsonb_agg(to_jsonb(s))
      from public.screens s
      join public.points p on p.id = s.point_id
      where p.campaign_id = campaign_row.id
    ), '[]'::jsonb),
    'dailyReports', coalesce((
      select jsonb_agg(to_jsonb(d))
      from public.daily_screen_reports d
      join public.screens s on s.id = d.screen_id
      join public.points p on p.id = s.point_id
      where p.campaign_id = campaign_row.id
    ), '[]'::jsonb),
    'videos', coalesce((
      select jsonb_agg(to_jsonb(v))
      from public.videos v
      where v.campaign_id = campaign_row.id
    ), '[]'::jsonb)
  ) into response;

  return response;
end;
$$;

revoke all on function public.get_public_client_report(text) from public;
grant execute on function public.get_public_client_report(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('client-media', 'client-media', true, 104857600, array['video/mp4', 'image/png', 'image/jpeg']),
  ('report-pdfs', 'report-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public reads client media"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'client-media');

create policy "admin uploads client media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'client-media' and public.is_admin());

create policy "admin updates client media"
  on storage.objects for update to authenticated
  using (bucket_id = 'client-media' and public.is_admin())
  with check (bucket_id = 'client-media' and public.is_admin());

create policy "admin deletes client media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'client-media' and public.is_admin());

create policy "admin manages report pdfs"
  on storage.objects for all to authenticated
  using (bucket_id = 'report-pdfs' and public.is_admin())
  with check (bucket_id = 'report-pdfs' and public.is_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.campaigns,
  public.points,
  public.screens,
  public.daily_screen_reports,
  public.videos,
  public.pdf_reports to authenticated;
grant select on public.admin_users to authenticated;
grant all privileges on
  public.admin_users,
  public.campaigns,
  public.points,
  public.screens,
  public.daily_screen_reports,
  public.videos,
  public.pdf_reports,
  public.private_settings to service_role;

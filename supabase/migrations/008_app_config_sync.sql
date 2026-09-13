-- ============================================
-- ze-payroll: App config sync migration
--
-- Why: payroll_settings (see 001_attendance_kiosk.sql) only ever held
-- the narrow slice of settings the kiosk RPC needs to classify a punch
-- (schedule, late tiers, sunday_all_ot, timezone, geofence). Everything
-- else on the Settings page - OT rate, the peso late-deduction table,
-- statutory deduction options, default employee rates, pay periods,
-- and company info - lived only in the browser's own localStorage.
-- That's per-browser, per-device storage, so an admin signing into the
-- same account from a PC and a phone would see two different, unrelated
-- copies of Settings. This table gives that the rest of Settings a
-- single shared home, the same way employees/dtr_entries already have.
--
-- Run this in the Supabase SQL Editor as the `postgres` role.
-- Idempotent: safe to re-run.
-- ============================================

create table if not exists public.app_config (
    id smallint primary key default 1 check (id = 1),
    settings jsonb not null default '{}'::jsonb,
    company jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

insert into public.app_config (id)
values (1)
on conflict (id) do nothing;

drop trigger if exists trg_app_config_updated_at on public.app_config;
create trigger trg_app_config_updated_at
    before update on public.app_config
    for each row execute function public.set_updated_at();

-- Admin-only: this holds full settings plus company statutory numbers,
-- so it's authenticated-only, same as employees/dtr_entries. The kiosk
-- (anon) never touches this table - it only ever talks to
-- payroll_settings and the record_attendance_punch RPC.
alter table public.app_config enable row level security;

drop policy if exists "admin full access" on public.app_config;
create policy "admin full access" on public.app_config
    for all
    to authenticated
    using (true)
    with check (true);

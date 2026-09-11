-- ============================================
-- ze-payroll: Attendance Kiosk migration
-- Adds Supabase-backed employees & DTR entries so a wall-mounted QR
-- can be scanned by an employee's own phone and land, live, on the
-- admin dashboard - plus a PIN-protected RPC so a scan can't be used
-- to punch a coworker in.
--
-- Run this in the Supabase SQL Editor as the `postgres` role.
-- Idempotent: safe to re-run.
-- ============================================

create extension if not exists pgcrypto;

-- ------------------------------------------------
-- employees
-- ------------------------------------------------
create table if not exists public.employees (
    id text primary key,
    first_name text not null,
    middle_name text default '',
    last_name text not null,
    position text default '',
    department text default '',
    email text default '',
    phone text default '',
    address text default '',
    daily_rate numeric default 0,
    hourly_rate numeric default 0,
    base_daily_pay numeric default 0,
    hire_date date,
    sss_number text default '',
    philhealth_number text default '',
    pagibig_number text default '',
    tin text default '',
    status text not null default 'active' check (status in ('active', 'inactive', 'on_leave')),
    pin_hash text, -- set via set_employee_pin(); never exposed to anon directly
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create sequence if not exists public.employee_id_seq;

create or replace function public.generate_employee_id()
returns text
language sql
as $$
    select 'EMP-' || extract(year from now())::text || '-' ||
           lpad(nextval('public.employee_id_seq')::text, 3, '0');
$$;

-- ------------------------------------------------
-- dtr_entries (one row per employee per day)
-- ------------------------------------------------
create table if not exists public.dtr_entries (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null references public.employees(id) on delete cascade,
    date date not null,
    time_in time,
    time_out time,
    total_hours numeric default 0,
    ot_hours numeric default 0,
    late_minutes integer default 0,
    status text not null default 'present' check (status in ('present', 'late', 'half_day', 'absent')),
    source text not null default 'manual' check (source in ('manual', 'paste_import', 'kiosk', 'camera_scan')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (employee_id, date)
);

create index if not exists dtr_entries_date_idx on public.dtr_entries (date);
create index if not exists dtr_entries_employee_idx on public.dtr_entries (employee_id);

-- ------------------------------------------------
-- payroll_settings (single row) - just the fields the kiosk RPC
-- needs to classify a punch. Full pay-rate settings can stay local
-- for now; this table is the shared source of truth for attendance
-- rules only.
-- ------------------------------------------------
create table if not exists public.payroll_settings (
    id smallint primary key default 1 check (id = 1),
    schedule_am_in time not null default '08:00',
    schedule_am_out time not null default '12:00',
    schedule_pm_in time not null default '13:00',
    schedule_pm_out time not null default '17:00',
    late_grace_end int not null default 10,
    late_per_minute_end int not null default 29,
    late_flat_1hr_end int not null default 59,
    late_flat_2hr_end int not null default 89,
    late_half_day_end int not null default 149,
    sunday_all_ot boolean not null default true,
    timezone text not null default 'Asia/Manila',
    updated_at timestamptz not null default now()
);

insert into public.payroll_settings (id)
values (1)
on conflict (id) do nothing;

-- ------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
    before update on public.employees
    for each row execute function public.set_updated_at();

drop trigger if exists trg_dtr_entries_updated_at on public.dtr_entries;
create trigger trg_dtr_entries_updated_at
    before update on public.dtr_entries
    for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_settings_updated_at on public.payroll_settings;
create trigger trg_payroll_settings_updated_at
    before update on public.payroll_settings
    for each row execute function public.set_updated_at();

-- ------------------------------------------------
-- RLS - admin (authenticated) gets full access.
-- anon (kiosk page, no login) gets NOTHING directly: it can only
-- read employee names through the safe view below, and can only
-- write attendance through the SECURITY DEFINER RPC.
-- ------------------------------------------------
alter table public.employees enable row level security;
alter table public.dtr_entries enable row level security;
alter table public.payroll_settings enable row level security;

drop policy if exists "admin full access" on public.employees;
create policy "admin full access" on public.employees
    for all
    to authenticated
    using (true)
    with check (true);

drop policy if exists "admin full access" on public.dtr_entries;
create policy "admin full access" on public.dtr_entries
    for all
    to authenticated
    using (true)
    with check (true);

drop policy if exists "admin full access" on public.payroll_settings;
create policy "admin full access" on public.payroll_settings
    for all
    to authenticated
    using (true)
    with check (true);

-- No policies at all for `anon` on any of the three tables above -
-- RLS default-denies, which is intentional. The kiosk only ever
-- talks to the two functions below.

-- ------------------------------------------------
-- Safe public view for the kiosk to greet the employee by name
-- before they enter their PIN. No pay/contact/PIN data exposed.
-- ------------------------------------------------
create or replace view public.employees_kiosk_view as
    select id, first_name, last_name, status
    from public.employees;

grant select on public.employees_kiosk_view to anon;

-- ------------------------------------------------
-- set_employee_pin(employee_id, pin) - admin-only, called from the
-- main app when creating/editing an employee.
-- ------------------------------------------------
create or replace function public.set_employee_pin(p_employee_id text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_pin !~ '^[0-9]{4}$' then
        raise exception 'PIN must be exactly 4 digits';
    end if;

    update public.employees
    set pin_hash = crypt(p_pin, gen_salt('bf'))
    where id = p_employee_id;

    if not found then
        raise exception 'Employee % not found', p_employee_id;
    end if;
end;
$$;

-- Only admins (authenticated) may set PINs.
revoke all on function public.set_employee_pin(text, text) from public;
grant execute on function public.set_employee_pin(text, text) to authenticated;

-- ------------------------------------------------
-- record_attendance_punch(employee_id, pin) - the kiosk entry point.
-- Verifies the PIN server-side (pin hash never leaves the database),
-- figures out whether this is a time-in or time-out, applies the
-- late/OT/Sunday rules from payroll_settings, and upserts the day's
-- dtr_entries row. Runs as SECURITY DEFINER so `anon` never needs
-- direct table access.
-- ------------------------------------------------
create or replace function public.record_attendance_punch(p_employee_id text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_emp record;
    v_settings record;
    v_tz text;
    v_now timestamptz := now();
    v_today date;
    v_now_time time;
    v_existing record;
    v_action text;
    v_late_minutes int := 0;
    v_status text := 'present';
    v_worked_minutes int;
    v_ot_minutes int := 0;
    v_lunch_gap int;
    v_in_min int;
    v_out_min int;
    v_am_in int;
    v_am_out int;
    v_pm_in int;
    v_pm_out int;
    v_is_sunday boolean;
begin
    select * into v_emp from public.employees where id = p_employee_id;

    if not found then
        return json_build_object('success', false, 'message', 'Employee not found.');
    end if;

    if v_emp.status <> 'active' then
        return json_build_object('success', false, 'message', 'This employee is not active.');
    end if;

    if v_emp.pin_hash is null then
        return json_build_object('success', false, 'message', 'No PIN has been set up for this employee yet. Please see your admin.');
    end if;

    if v_emp.pin_hash <> crypt(p_pin, v_emp.pin_hash) then
        return json_build_object('success', false, 'message', 'Incorrect PIN.');
    end if;

    select * into v_settings from public.payroll_settings where id = 1;
    v_tz := coalesce(v_settings.timezone, 'Asia/Manila');
    v_today := (v_now at time zone v_tz)::date;
    v_now_time := (v_now at time zone v_tz)::time;
    v_is_sunday := extract(dow from v_today) = 0;

    select * into v_existing
    from public.dtr_entries
    where employee_id = p_employee_id and date = v_today;

    if found and v_existing.time_out is null then
        -- ---- TIME OUT ----
        v_action := 'time_out';

        v_am_in  := extract(hour from v_settings.schedule_am_in)  * 60 + extract(minute from v_settings.schedule_am_in);
        v_am_out := extract(hour from v_settings.schedule_am_out) * 60 + extract(minute from v_settings.schedule_am_out);
        v_pm_in  := extract(hour from v_settings.schedule_pm_in)  * 60 + extract(minute from v_settings.schedule_pm_in);
        v_pm_out := extract(hour from v_settings.schedule_pm_out) * 60 + extract(minute from v_settings.schedule_pm_out);
        v_in_min := extract(hour from v_existing.time_in) * 60 + extract(minute from v_existing.time_in);
        v_out_min := extract(hour from v_now_time) * 60 + extract(minute from v_now_time);
        if v_out_min <= v_in_min then
            v_out_min := v_out_min + 24 * 60; -- guard against an overnight/odd punch
        end if;

        v_worked_minutes := v_out_min - v_in_min;
        v_lunch_gap := greatest(0, v_pm_in - v_am_out);
        if v_lunch_gap > 0 and v_in_min <= v_am_out and v_out_min >= v_pm_in then
            v_worked_minutes := v_worked_minutes - v_lunch_gap;
        end if;
        v_worked_minutes := greatest(0, v_worked_minutes);

        if v_out_min > v_pm_out then
            v_ot_minutes := v_out_min - v_pm_out;
        end if;

        v_late_minutes := v_existing.late_minutes;
        v_status := v_existing.status;

        if v_is_sunday and v_settings.sunday_all_ot then
            v_ot_minutes := v_worked_minutes;
        end if;

        update public.dtr_entries
        set time_out = v_now_time,
            total_hours = round(v_worked_minutes / 60.0, 2),
            ot_hours = round(v_ot_minutes / 60.0, 2),
            source = 'kiosk'
        where id = v_existing.id;

    elsif found and v_existing.time_out is not null then
        -- Already completed a full in/out cycle today.
        return json_build_object(
            'success', false,
            'message', 'You already logged in and out today at ' ||
                        to_char(v_existing.time_in, 'HH12:MI AM') || ' - ' ||
                        to_char(v_existing.time_out, 'HH12:MI AM') || '.'
        );

    else
        -- ---- TIME IN ----
        v_action := 'time_in';

        v_am_in := extract(hour from v_settings.schedule_am_in) * 60 + extract(minute from v_settings.schedule_am_in);
        v_in_min := extract(hour from v_now_time) * 60 + extract(minute from v_now_time);
        v_late_minutes := greatest(0, v_in_min - v_am_in);

        if v_is_sunday and v_settings.sunday_all_ot then
            v_late_minutes := 0;
            v_status := 'present';
        elsif v_late_minutes <= v_settings.late_grace_end then
            v_status := 'present';
        elsif v_late_minutes <= v_settings.late_flat_2hr_end then
            v_status := 'late';
        elsif v_late_minutes <= v_settings.late_half_day_end then
            v_status := 'half_day';
        else
            v_status := 'absent';
        end if;

        insert into public.dtr_entries (employee_id, date, time_in, status, late_minutes, source)
        values (p_employee_id, v_today, v_now_time, v_status, v_late_minutes, 'kiosk');
    end if;

    return json_build_object(
        'success', true,
        'action', v_action,
        'employee_name', v_emp.first_name || ' ' || v_emp.last_name,
        'time', to_char(v_now_time, 'HH12:MI AM'),
        'status', v_status
    );
end;
$$;

-- Anyone (including anon, i.e. the kiosk page) may call this - the
-- PIN check inside is what protects it, not the grant.
revoke all on function public.record_attendance_punch(text, text) from public;
grant execute on function public.record_attendance_punch(text, text) to anon, authenticated;

-- ------------------------------------------------
-- Realtime: let the admin dashboard subscribe and update live.
-- Only `authenticated` connections can actually receive these
-- events, since Realtime still respects the RLS policies above.
-- ------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dtr_entries'
    ) then
        alter publication supabase_realtime add table public.dtr_entries;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employees'
    ) then
        alter publication supabase_realtime add table public.employees;
    end if;
end;
$$;

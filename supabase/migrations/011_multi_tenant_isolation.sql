-- =============================================================
-- ze-payroll 011 — Multi-tenant workspace isolation
-- Run AFTER 010_client_plan_selection.sql
--
-- THE BUG THIS FIXES: employees / dtr_entries / payroll_settings /
-- app_config had no concept of "whose" data a row was - the RLS
-- policy on all four was `using (true)`, meaning ANY authenticated
-- user could see and edit ALL of them. That was fine when only one
-- business used this Supabase project. Now that self-registration is
-- live, a second client logging in saw the first client's real
-- employees. This migration gives every row an owner (workspace_id,
-- = the admin's own auth user id) and locks RLS down to
-- `workspace_id = auth.uid()`.
--
-- THIS FILE IS IN THREE PARTS. Run them IN ORDER, and read the note
-- before Part 2 - it requires one manual step (finding your own
-- existing admin account's user id) before it's safe to run.
-- =============================================================


-- #############################################################
-- PART 1 - safe to run immediately, no manual steps.
-- Adds the columns (nullable for now), and makes sure every NEW
-- signup automatically gets their own payroll_settings + app_config
-- row from now on (previously there was only ever one shared row).
-- #############################################################

alter table public.employees        add column if not exists workspace_id uuid;
alter table public.dtr_entries      add column if not exists workspace_id uuid;
alter table public.payroll_settings add column if not exists workspace_id uuid;
alter table public.app_config       add column if not exists workspace_id uuid;

-- Every new client now gets their own payroll_settings + app_config
-- row the moment they sign up (previously only the profiles row was
-- created here - the shared payroll_settings/app_config row already
-- existed from 001/008, so this never had to run before).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, business_name, plan_id, subscription_status, current_period_end)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
        null,
        'never',
        null
    );

    insert into public.payroll_settings (workspace_id) values (new.id)
    on conflict (workspace_id) do nothing;

    insert into public.app_config (workspace_id) values (new.id)
    on conflict (workspace_id) do nothing;

    return new;
end;
$$;


-- #############################################################
-- STOP AND READ before Part 2.
--
-- Part 2 assigns all of your EXISTING employees/DTR/settings/config
-- rows (the ones already in this database - your pilot client's real
-- data) to one specific workspace_id: your own admin account's user
-- id, i.e. whichever Supabase Auth account you've been logging into
-- app.html with all along.
--
-- Run this SELECT first to find it:
--
--     select id, email, created_at from auth.users order by created_at;
--
-- Look at the list and copy the `id` (a UUID) next to the email you
-- use to log into app.html for your own business's payroll. Then
-- open Part 2 below, replace every occurrence of
-- 'PASTE-YOUR-ADMIN-USER-ID-HERE' with that UUID (keep the quotes),
-- and run Part 2.
--
-- If that email hasn't registered through register.html yet (e.g.
-- it's an account you created directly in the Supabase dashboard
-- before self-registration existed), it won't have a `profiles` row
-- yet either - Part 2 creates one for it automatically.
-- #############################################################


-- #############################################################
-- PART 2 - EDIT THE UUID BELOW, THEN RUN.
-- #############################################################

do $$
declare
    v_admin_id uuid := 'PASTE-YOUR-ADMIN-USER-ID-HERE';
begin
    if v_admin_id::text = 'PASTE-YOUR-ADMIN-USER-ID-HERE' then
        raise exception 'Edit this file: replace PASTE-YOUR-ADMIN-USER-ID-HERE with your real admin user id (see the instructions above) before running Part 2.';
    end if;

    if not exists (select 1 from auth.users where id = v_admin_id) then
        raise exception 'No auth.users row with id %. Double-check you copied the UUID correctly from the SELECT above.', v_admin_id;
    end if;

    -- Make sure this admin has a profile (creates one, on a free
    -- trial, if this account predates self-registration entirely).
    insert into public.profiles (id, email, business_name, subscription_status)
    select v_admin_id, u.email, 'My Business', 'trial'
    from auth.users u where u.id = v_admin_id
    on conflict (id) do nothing;

    update public.employees        set workspace_id = v_admin_id where workspace_id is null;
    update public.dtr_entries      set workspace_id = v_admin_id where workspace_id is null;
    update public.payroll_settings set workspace_id = v_admin_id where workspace_id is null;
    update public.app_config       set workspace_id = v_admin_id where workspace_id is null;
end $$;


-- #############################################################
-- PART 3 - locks everything down. Run this only after Part 2 has
-- completed with NO error (if Part 2 raised an exception, nothing
-- was changed - fix it and re-run Part 2 first).
-- #############################################################

-- ---- employees: workspace_id + id together are the real identity now ----
alter table public.dtr_entries drop constraint if exists dtr_entries_employee_id_fkey;
alter table public.employees drop constraint if exists employees_pkey;
alter table public.employees alter column workspace_id set not null;
alter table public.employees add primary key (workspace_id, id);

-- ---- dtr_entries: composite FK + composite uniqueness ----
alter table public.dtr_entries drop constraint if exists dtr_entries_employee_id_date_key;
alter table public.dtr_entries alter column workspace_id set not null;
alter table public.dtr_entries add constraint dtr_entries_employee_fkey
    foreign key (workspace_id, employee_id) references public.employees(workspace_id, id) on delete cascade;
alter table public.dtr_entries add constraint dtr_entries_workspace_employee_date_key
    unique (workspace_id, employee_id, date);

-- ---- payroll_settings / app_config: one row per workspace, not one shared row ----
alter table public.payroll_settings drop constraint if exists payroll_settings_pkey;
alter table public.payroll_settings alter column workspace_id set not null;
alter table public.payroll_settings add primary key (workspace_id);

alter table public.app_config drop constraint if exists app_config_pkey;
alter table public.app_config alter column workspace_id set not null;
alter table public.app_config add primary key (workspace_id);

-- ---- RLS: replace the old "any authenticated user, full access" ----
drop policy if exists "admin full access" on public.employees;
create policy "own workspace only" on public.employees
    for all to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

drop policy if exists "admin full access" on public.dtr_entries;
create policy "own workspace only" on public.dtr_entries
    for all to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

drop policy if exists "admin full access" on public.payroll_settings;
create policy "own workspace only" on public.payroll_settings
    for all to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

drop policy if exists "admin full access" on public.app_config;
create policy "own workspace only" on public.app_config
    for all to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

-- ---- Kiosk view: needs workspace_id so scan.html knows whose employee list to check ----
create or replace view public.employees_kiosk_view as
    select id, workspace_id, first_name, last_name, status
    from public.employees;

-- ---- generate_employee_id() / set_employee_pin(): scope to the
-- calling admin's OWN workspace via auth.uid() - no client-supplied
-- workspace param needed (or trusted) for these, since the caller is
-- always authenticated. ----
drop function if exists public.generate_employee_id();
create function public.generate_employee_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_next int;
begin
    select coalesce(max(substring(id from '(\d+)$')::int), 0) + 1 into v_next
    from public.employees where workspace_id = auth.uid();
    return 'EMP-' || extract(year from now())::text || '-' || lpad(v_next::text, 3, '0');
end;
$$;
grant execute on function public.generate_employee_id() to authenticated;

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
    where workspace_id = auth.uid() and id = p_employee_id;

    if not found then
        raise exception 'Employee % not found', p_employee_id;
    end if;
end;
$$;

-- ---- record_attendance_punch: the kiosk is anonymous (no auth.uid()),
-- so it's the one function that genuinely needs the workspace passed
-- in explicitly (embedded in the printed QR's URL - see
-- getKioskScanUrl() in app.js). Old 5-arg version is dropped so
-- there's no ambiguity about which one anon can call. ----
drop function if exists public.record_attendance_punch(text, text, double precision, double precision, double precision);

create or replace function public.record_attendance_punch(
    p_workspace_id uuid,
    p_employee_id text,
    p_pin text,
    p_lat double precision default null,
    p_lng double precision default null,
    p_accuracy_m double precision default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
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
    v_is_half_day boolean;
    v_distance_m double precision;
    v_effective_radius_m double precision;
begin
    if p_workspace_id is null then
        return json_build_object('success', false, 'message', 'This QR code is missing information and can''t be used. Please reprint it from the app.');
    end if;

    select * into v_emp from public.employees where workspace_id = p_workspace_id and id = p_employee_id;

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

    select * into v_settings from public.payroll_settings where workspace_id = p_workspace_id;

    -- ---- Geofence check (server-side - can't be bypassed from the browser) ----
    if v_settings.geofence_enabled and v_settings.office_lat is not null and v_settings.office_lng is not null then
        if p_lat is null or p_lng is null then
            return json_build_object(
                'success', false,
                'reason', 'geofence',
                'message', 'Location access is required to log attendance here. Please enable location services and try again.'
            );
        end if;

        v_distance_m := public.haversine_meters(v_settings.office_lat, v_settings.office_lng, p_lat, p_lng);
        v_effective_radius_m := v_settings.geofence_radius_m + least(coalesce(p_accuracy_m, 0), 50);

        if v_distance_m > v_effective_radius_m then
            return json_build_object(
                'success', false,
                'reason', 'geofence',
                'message', 'You must be at the office to log attendance. You appear to be about ' ||
                           round(v_distance_m::numeric)::text || 'm away.'
            );
        end if;
    end if;

    v_tz := coalesce(v_settings.timezone, 'Asia/Manila');
    v_today := (v_now at time zone v_tz)::date;
    v_now_time := (v_now at time zone v_tz)::time;
    v_is_sunday := extract(dow from v_today) = 0;

    v_am_in  := extract(hour from v_settings.schedule_am_in)  * 60 + extract(minute from v_settings.schedule_am_in);
    v_am_out := extract(hour from v_settings.schedule_am_out) * 60 + extract(minute from v_settings.schedule_am_out);
    v_pm_in  := extract(hour from v_settings.schedule_pm_in)  * 60 + extract(minute from v_settings.schedule_pm_in);
    v_pm_out := extract(hour from v_settings.schedule_pm_out) * 60 + extract(minute from v_settings.schedule_pm_out);

    select * into v_existing
    from public.dtr_entries
    where workspace_id = p_workspace_id and employee_id = p_employee_id and date = v_today;

    if found and v_existing.time_out is null then
        -- ---- TIME OUT (finalizes status/lateness now that both ends of the shift are known) ----
        v_action := 'time_out';

        v_in_min := extract(hour from v_existing.time_in) * 60 + extract(minute from v_existing.time_in);
        v_out_min := extract(hour from v_now_time) * 60 + extract(minute from v_now_time);
        if v_out_min <= v_in_min then
            v_out_min := v_out_min + 24 * 60;
        end if;

        v_worked_minutes := v_out_min - v_in_min;
        v_lunch_gap := greatest(0, v_pm_in - v_am_out);
        if v_lunch_gap > 0 and v_in_min <= v_am_out and v_out_min >= v_pm_in then
            v_worked_minutes := v_worked_minutes - v_lunch_gap;
        end if;
        v_worked_minutes := greatest(0, v_worked_minutes);

        v_ot_minutes := 0;
        if v_out_min > v_pm_out then
            v_ot_minutes := v_out_min - v_pm_out;
        end if;

        if v_is_sunday and v_settings.sunday_all_ot then
            v_late_minutes := 0;
            v_status := 'present';
            v_ot_minutes := v_worked_minutes;
        else
            if v_in_min >= v_pm_in then
                v_is_half_day := true;
                v_late_minutes := greatest(0, v_in_min - v_pm_in);
            elsif v_out_min <= v_pm_in then
                v_is_half_day := true;
                v_late_minutes := greatest(0, v_in_min - v_am_in);
            else
                v_is_half_day := false;
                v_late_minutes := greatest(0, v_in_min - v_am_in);
            end if;

            if v_late_minutes > v_settings.late_half_day_end then
                v_status := 'absent';
            elsif v_is_half_day then
                v_status := 'half_day';
            elsif v_late_minutes <= v_settings.late_grace_end then
                v_status := 'present';
            elsif v_late_minutes <= v_settings.late_flat_2hr_end then
                v_status := 'late';
            else
                v_status := 'half_day';
            end if;
        end if;

        update public.dtr_entries
        set time_out = v_now_time,
            total_hours = round(v_worked_minutes / 60.0, 2),
            ot_hours = round(v_ot_minutes / 60.0, 2),
            late_minutes = v_late_minutes,
            status = v_status,
            source = 'kiosk'
        where id = v_existing.id;

    elsif found and v_existing.time_out is not null then
        return json_build_object(
            'success', false,
            'message', 'You already logged in and out today at ' ||
                        to_char(v_existing.time_in, 'HH12:MI AM') || ' - ' ||
                        to_char(v_existing.time_out, 'HH12:MI AM') || '.'
        );

    else
        -- ---- TIME IN (preliminary - finalized at TIME OUT above) ----
        v_action := 'time_in';

        v_in_min := extract(hour from v_now_time) * 60 + extract(minute from v_now_time);

        if v_is_sunday and v_settings.sunday_all_ot then
            v_late_minutes := 0;
            v_status := 'present';
        else
            if v_in_min >= v_pm_in then
                v_late_minutes := greatest(0, v_in_min - v_pm_in);
            else
                v_late_minutes := greatest(0, v_in_min - v_am_in);
            end if;

            if v_late_minutes <= v_settings.late_grace_end then
                v_status := 'present';
            elsif v_late_minutes <= v_settings.late_flat_2hr_end then
                v_status := 'late';
            elsif v_late_minutes <= v_settings.late_half_day_end then
                v_status := 'half_day';
            else
                v_status := 'absent';
            end if;
        end if;

        insert into public.dtr_entries (workspace_id, employee_id, date, time_in, status, late_minutes, source)
        values (p_workspace_id, p_employee_id, v_today, v_now_time, v_status, v_late_minutes, 'kiosk');
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

revoke all on function public.record_attendance_punch(uuid, text, text, double precision, double precision, double precision) from public;
grant execute on function public.record_attendance_punch(uuid, text, text, double precision, double precision, double precision) to anon, authenticated;

-- ---- IMPORTANT: any QR codes already printed before this migration
-- encode a URL WITHOUT &ws=... and will now show "QR Code Not
-- Recognized" when scanned. Reprint them from the Employees page
-- (the QR generation code was updated alongside this migration to
-- include the workspace automatically) - existing PINs are untouched,
-- so employees don't need to redo PIN setup, just get the new QR.

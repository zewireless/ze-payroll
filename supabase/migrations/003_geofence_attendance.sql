-- ============================================
-- ze-payroll: Attendance geofencing migration
-- Lets an admin restrict the self-service kiosk (scan.html) so an
-- employee can only time in/out from within a configured radius of the
-- office. Off by default (geofence_enabled = false) so existing
-- installs keep working unchanged until an admin turns it on from
-- Settings > Attendance Security (Geofencing).
--
-- Run this in the Supabase SQL Editor as the `postgres` role, after
-- 001_attendance_kiosk.sql and 002_fix_pgcrypto_schema.sql.
-- Idempotent: safe to re-run.
-- ============================================

-- ------------------------------------------------
-- payroll_settings: office location + geofence radius
-- ------------------------------------------------
alter table public.payroll_settings
    add column if not exists geofence_enabled boolean not null default false,
    add column if not exists office_lat double precision,
    add column if not exists office_lng double precision,
    add column if not exists geofence_radius_m integer not null default 50;

-- ------------------------------------------------
-- Great-circle distance between two lat/lng points, in meters.
-- ------------------------------------------------
create or replace function public.haversine_meters(
    lat1 double precision, lng1 double precision,
    lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
    select 2 * 6371000 * asin(
        sqrt(
            sin(radians(lat2 - lat1) / 2) ^ 2 +
            cos(radians(lat1)) * cos(radians(lat2)) *
            sin(radians(lng2 - lng1) / 2) ^ 2
        )
    );
$$;

-- ------------------------------------------------
-- record_attendance_punch: add geofence enforcement.
-- Drop the old 2-argument version first since adding parameters
-- creates a new overload rather than replacing it - leaving the old
-- one callable would let anyone bypass the location check entirely.
-- ------------------------------------------------
drop function if exists public.record_attendance_punch(text, text);

create or replace function public.record_attendance_punch(
    p_employee_id text,
    p_pin text,
    p_lat double precision default null,
    p_lng double precision default null,
    p_accuracy_m double precision default null
)
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
    v_distance_m double precision;
    v_effective_radius_m double precision;
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
        -- Forgive a little for the phone's own reported GPS uncertainty
        -- (capped, so a spoofed huge "accuracy" value can't widen this
        -- indefinitely).
        v_effective_radius_m := v_settings.geofence_radius_m + least(coalesce(p_accuracy_m, 0), 50);

        if v_distance_m > v_effective_radius_m then
            return json_build_object(
                'success', false,
                'reason', 'geofence',
                'message', 'You must be at the office to log attendance. You appear to be about ' ||
                           round(v_distance_m)::text || 'm away.'
            );
        end if;
    end if;

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

-- Anyone (including anon, i.e. the kiosk page) may call this - the PIN
-- check and geofence check inside are what protect it, not the grant.
revoke all on function public.record_attendance_punch(text, text, double precision, double precision, double precision) from public;
grant execute on function public.record_attendance_punch(text, text, double precision, double precision, double precision) to anon, authenticated;

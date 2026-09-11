-- ============================================
-- ze-payroll: fix pgcrypto schema for the attendance kiosk functions
--
-- Supabase installs pgcrypto into the `extensions` schema (not
-- `public`), so gen_salt()/crypt() weren't visible to
-- set_employee_pin() and record_attendance_punch(), which had
-- `set search_path = public` only. This widens the search_path on
-- both functions. Safe to re-run.
-- ============================================

-- Belt-and-suspenders: make sure pgcrypto is enabled, in whichever
-- schema Supabase puts it (usually `extensions`).
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_employee_pin(p_employee_id text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
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

revoke all on function public.set_employee_pin(text, text) from public;
grant execute on function public.set_employee_pin(text, text) to authenticated;

create or replace function public.record_attendance_punch(p_employee_id text, p_pin text)
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
            v_out_min := v_out_min + 24 * 60;
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

revoke all on function public.record_attendance_punch(text, text) from public;
grant execute on function public.record_attendance_punch(text, text) to anon, authenticated;

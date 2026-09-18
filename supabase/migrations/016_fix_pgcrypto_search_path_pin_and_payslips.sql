-- =============================================================
-- ze-payroll 016 — fix pgcrypto search_path (again), this time for
-- set_employee_pin() and get_employee_payslips()
--
-- WHY THIS KEEPS HAPPENING: Supabase installs pgcrypto (crypt(),
-- gen_salt()) into the `extensions` schema, not `public`. 002 and 005
-- already patched this for set_employee_pin() and
-- record_attendance_punch(), but 011 (multi-tenant isolation)
-- recreated set_employee_pin() from scratch with `set search_path =
-- public` only, silently dropping the 002 fix - that's the "function
-- gen_salt(unknown) does not exist" error on adding a new employee.
-- 015's get_employee_payslips() has the same bug: it calls crypt()
-- to check the employee's PIN but was only given `search_path =
-- public`, so the payslip portal would fail the exact same way the
-- first time anyone tried to log in.
--
-- Both are widened here to `public, extensions`, matching
-- record_attendance_punch (011, line 215) which already has it
-- right. Run after 015. Idempotent: safe to re-run.
-- =============================================================

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
    where workspace_id = auth.uid() and id = p_employee_id;

    if not found then
        raise exception 'Employee % not found', p_employee_id;
    end if;
end;
$$;

create or replace function public.get_employee_payslips(
    p_workspace_id uuid,
    p_employee_id text,
    p_pin text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_emp record;
    v_rows json;
begin
    select * into v_emp
    from public.employees
    where workspace_id = p_workspace_id and id = p_employee_id;

    if not found then
        return json_build_object('success', false, 'message', 'Employee not found.');
    end if;

    if v_emp.pin_hash is null then
        return json_build_object('success', false, 'message', 'No PIN has been set up for this employee yet. Please see your admin.');
    end if;

    if v_emp.pin_hash <> crypt(p_pin, v_emp.pin_hash) then
        return json_build_object('success', false, 'message', 'Incorrect PIN.');
    end if;

    select coalesce(json_agg(row_to_json(t) order by t.period_start desc), '[]'::json) into v_rows
    from (
        select id, period_start, period_end, payout_date, snapshot, created_at
        from public.payroll_runs
        where workspace_id = p_workspace_id and employee_id = p_employee_id
    ) t;

    return json_build_object(
        'success', true,
        'employee_name', v_emp.first_name || ' ' || v_emp.last_name,
        'payslips', v_rows
    );
end;
$$;

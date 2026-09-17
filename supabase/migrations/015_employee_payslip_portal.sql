-- =============================================================
-- ze-payroll 015 — employee-facing payslip portal
--
-- WHAT THIS ADDS:
-- 1. payroll_runs - a persisted snapshot of every "Compute Payroll"
--    result, per employee per period. Until now, processPayroll()
--    in app.js only ever wrote to the admin's own browser
--    localStorage - nothing was in Supabase, so there was nothing
--    an employee's own phone could ever read. This table is the
--    server-side record that makes an employee portal possible at
--    all, and follows the same workspace_id-owned, RLS-locked
--    pattern as employees/dtr_entries (011).
-- 2. record_payroll_run() - called from processPayroll() (as the
--    signed-in admin) to upsert one employee's snapshot for a period.
-- 3. get_employee_payslips() - the anon entry point for the portal
--    page (payslip.html). Mirrors record_attendance_punch's PIN
--    check exactly (bcrypt via pgcrypto's crypt(), never exposing
--    pin_hash itself) - the employee's existing attendance-kiosk PIN
--    is what gates this, no separate login system.
--
-- Run this in the Supabase SQL Editor as the `postgres` role, after
-- 011_multi_tenant_isolation.sql and 014_employee_payment_details.sql.
-- Idempotent: safe to re-run.
-- =============================================================

create table if not exists public.payroll_runs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    employee_id text not null,
    period_start date not null,
    period_end date not null,
    payout_date date,
    -- Full computeEmployeePayroll() breakdown (gross pay, deductions,
    -- OT, etc.) plus a payment_details sub-object snapshotted from the
    -- employee's payment_method/account fields at the time payroll was
    -- run - so a later change to how they're paid doesn't rewrite the
    -- history of a payslip already handed out.
    snapshot jsonb not null,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, employee_id) references public.employees(workspace_id, id) on delete cascade,
    unique (workspace_id, employee_id, period_start, period_end)
);

alter table public.payroll_runs enable row level security;

drop policy if exists "own workspace only" on public.payroll_runs;
create policy "own workspace only" on public.payroll_runs
    for all to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

-- ------------------------------------------------
-- record_payroll_run(...) - admin-only (the caller's own auth.uid()
-- is always the workspace, same as generate_employee_id()/
-- set_employee_pin()). Called once per active employee from
-- processPayroll() each time "Compute Payroll" runs. Re-running the
-- same period for the same employee overwrites that period's
-- snapshot rather than duplicating it.
-- ------------------------------------------------
create or replace function public.record_payroll_run(
    p_employee_id text,
    p_period_start date,
    p_period_end date,
    p_payout_date date,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.payroll_runs (workspace_id, employee_id, period_start, period_end, payout_date, snapshot)
    values (auth.uid(), p_employee_id, p_period_start, p_period_end, p_payout_date, p_snapshot)
    on conflict (workspace_id, employee_id, period_start, period_end)
    do update set
        payout_date = excluded.payout_date,
        snapshot = excluded.snapshot,
        created_at = now();
end;
$$;

revoke all on function public.record_payroll_run(text, date, date, date, jsonb) from public;
grant execute on function public.record_payroll_run(text, date, date, date, jsonb) to authenticated;

-- ------------------------------------------------
-- get_employee_payslips(workspace_id, employee_id, pin) - the
-- portal's entry point. Anonymous (the employee is on their own
-- phone, never logged in) - the PIN check inside is what protects
-- it, exactly like record_attendance_punch. Returns every stored
-- payslip for that employee, newest first.
-- ------------------------------------------------
create or replace function public.get_employee_payslips(
    p_workspace_id uuid,
    p_employee_id text,
    p_pin text
)
returns json
language plpgsql
security definer
set search_path = public
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

-- Anyone (including anon, i.e. the portal page) may call this - as
-- with the kiosk, the PIN check inside is what protects it, not the
-- grant. pin_hash itself is never selected out of this function.
revoke all on function public.get_employee_payslips(uuid, text, text) from public;
grant execute on function public.get_employee_payslips(uuid, text, text) to anon, authenticated;

-- =============================================================
-- 017_plan_employee_limits.sql
--
-- Hard per-plan cap on how many employees a workspace can have.
--
--   5-Day Trial  -> 2 employees
--   3-Month Plan -> 5 employees
--   6-Month Plan -> unlimited (NULL)
--
-- Enforced in the database (BEFORE INSERT trigger on employees), so
-- it cannot be bypassed by editing app.js, calling the REST API
-- directly, or the paste-DTR auto-create path. The frontend only
-- mirrors the rule for a nicer message.
--
-- The cap counts EVERY employee row in the workspace (active AND
-- inactive). Marking someone inactive does not free a slot; the row
-- must be deleted. Updates to existing rows are never blocked, so a
-- workspace that is over its cap after a downgrade can still edit
-- and run payroll for the people it already has - it just can't add
-- more.
-- =============================================================

-- 1. plans.max_employees (NULL = unlimited)
alter table public.plans add column if not exists max_employees integer
    check (max_employees is null or max_employees >= 1);

update public.plans set max_employees = 2    where slug = 'trial';
update public.plans set max_employees = 5    where slug = '3mo';
update public.plans set max_employees = null where slug = '6mo';

-- Landing-page / plan-picker feature text so the cap is visible
update public.plans set features = array_replace(features, 'Unlimited employees', 'Up to 2 employees') where slug = 'trial';
update public.plans set features = array_replace(features, 'Unlimited employees', 'Up to 5 employees') where slug = '3mo';

-- 2. Helper: cap for a given workspace (NULL = unlimited).
--    Workspaces with no profile/plan (pre-billing accounts) get NULL.
create or replace function public.workspace_employee_cap(p_workspace uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select pl.max_employees
    from public.profiles pr
    join public.plans pl on pl.id = pr.plan_id
    where pr.id = p_workspace;
$$;

-- 3. Trigger: block INSERT when the workspace is at its cap.
create or replace function public.enforce_plan_employee_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cap   integer;
    v_count integer;
begin
    v_cap := public.workspace_employee_cap(new.workspace_id);
    if v_cap is null then
        return new; -- unlimited plan (or no plan on file)
    end if;

    select count(*) into v_count
    from public.employees
    where workspace_id = new.workspace_id;

    if v_count >= v_cap then
        raise exception 'Employee limit reached: your plan allows up to % employee(s). Upgrade your plan to add more.', v_cap
            using errcode = 'P0001', hint = 'plan_employee_limit';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_plan_employee_limit on public.employees;
create trigger trg_enforce_plan_employee_limit
    before insert on public.employees
    for each row execute function public.enforce_plan_employee_limit();

-- 4. Expose cap + current count to the client via get_my_billing()
--    (additive keys only; existing callers are unaffected).
create or replace function public.get_my_billing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'status', prof.subscription_status,
        'period_end', prof.current_period_end,
        'business_name', prof.business_name,
        'plan_id', prof.plan_id,
        'plan_name', plan.name,
        'plan_slug', plan.slug,
        'price', plan.price,
        'currency', plan.currency,
        'trial_used', prof.trial_used,
        'max_employees', plan.max_employees,
        'employee_count', (select count(*) from public.employees e where e.workspace_id = prof.id),
        'pending_payment', (
            select jsonb_build_object(
                'id', pay.id, 'amount', pay.amount, 'method', pay.method,
                'plan_name', pl.name, 'created_at', pay.created_at
            )
            from public.payments pay
            left join public.plans pl on pl.id = pay.plan_id
            where pay.profile_id = prof.id and pay.status = 'pending'
            order by pay.created_at desc
            limit 1
        )
    ) into result
    from public.profiles prof
    left join public.plans plan on plan.id = prof.plan_id
    where prof.id = auth.uid();

    return coalesce(result, '{}'::jsonb);
end;
$$;

-- 5. Super-admin RPC to change a plan's cap from admin.html
--    (kept separate from admin_create_plan / admin_update_plan so
--    their existing signatures are untouched).
create or replace function public.admin_set_plan_max_employees(p_id uuid, p_max_employees integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if p_max_employees is not null and p_max_employees < 1 then
        raise exception 'max_employees must be NULL (unlimited) or at least 1';
    end if;
    update public.plans set max_employees = p_max_employees where id = p_id;
end;
$$;

grant execute on function public.admin_set_plan_max_employees(uuid, integer) to authenticated;
grant execute on function public.workspace_employee_cap(uuid) to authenticated;

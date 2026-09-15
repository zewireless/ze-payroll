-- =============================================================
-- ze-payroll 010 — Self-service plan picker at LOGIN, not at signup
-- Run AFTER 009_saas_billing.sql
--
-- Changes the flow to match ze-pos:
--   register.html no longer asks for a plan at all — it just creates
--   the account. The FIRST time that account logs in (and every time
--   after, until they have an active subscription), app.js shows a
--   paywall screen with the 3 plan cards. Picking the free trial
--   activates instantly. Picking a paid plan creates a 'pending'
--   payment claim that YOU approve from admin.html once you've
--   confirmed the GCash/Maya/bank transfer actually came in.
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. New signups start with NO plan and NO subscription at all -
--    the old handle_new_user() (from 009) read a plan_slug that
--    register.html no longer sends. Replace it with a bare insert.
-- -------------------------------------------------------------
alter table public.profiles add column if not exists trial_used boolean not null default false;

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
    return new;
end;
$$;
-- (trigger itself, on_auth_user_created, already exists from 009 and
-- points at this same function name - no need to recreate it.)

-- Widen the status check to include the new 'never' (signed up, has
-- not picked a plan yet) state.
alter table public.profiles drop constraint if exists profiles_subscription_status_check;
alter table public.profiles add constraint profiles_subscription_status_check
    check (subscription_status in ('never', 'trial', 'active', 'overdue', 'cancelled'));

-- -------------------------------------------------------------
-- 2. payments needs a status (pending/paid/failed) and a record of
--    which plan the claim was for, since profiles.plan_id can change
--    before you get around to approving it.
-- -------------------------------------------------------------
alter table public.payments add column if not exists status text not null default 'paid';
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
    check (status in ('pending', 'paid', 'failed'));
alter table public.payments add column if not exists plan_id uuid references public.plans(id);

drop policy if exists "own payments only" on public.payments;
create policy "own payments only" on public.payments
    for select
    to authenticated
    using (profile_id = auth.uid());

-- -------------------------------------------------------------
-- 3. submit_payment_claim() - client-callable, always for the
--    CALLER'S OWN account (auth.uid()), never anyone else's.
--    Free trial (price = 0): activates immediately, no approval
--    needed, and can only ever be used once per account.
--    Paid plan: creates a 'pending' claim; account stays exactly
--    as it was until you approve it from admin.html.
-- -------------------------------------------------------------
create or replace function public.submit_payment_claim(
    p_plan_id uuid,
    p_method text,
    p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan record;
    v_trial_used boolean;
begin
    select * into v_plan from public.plans where id = p_plan_id and active = true;
    if v_plan.id is null then
        raise exception 'Plan not found or no longer available';
    end if;

    if p_method not in ('gcash', 'maya', 'bank', 'other') then
        raise exception 'Invalid payment method';
    end if;

    if exists (select 1 from public.payments where profile_id = auth.uid() and status = 'pending') then
        raise exception 'You already have a payment submission awaiting review.';
    end if;

    if v_plan.price = 0 then
        select trial_used into v_trial_used from public.profiles where id = auth.uid();
        if v_trial_used then
            raise exception 'The free trial has already been used on this account.';
        end if;

        insert into public.payments (profile_id, plan_id, amount, method, status, reference)
        values (auth.uid(), v_plan.id, 0, p_method, 'paid', p_reference);

        update public.profiles
        set subscription_status = 'trial',
            plan_id = v_plan.id,
            trial_used = true,
            current_period_end = now() + make_interval(days => v_plan.duration_days)
        where id = auth.uid();

        return jsonb_build_object('activated', true, 'status', 'trial');
    else
        insert into public.payments (profile_id, plan_id, amount, method, status, reference)
        values (auth.uid(), v_plan.id, v_plan.price, p_method, 'pending', p_reference);

        return jsonb_build_object('activated', false, 'status', 'pending');
    end if;
end;
$$;

grant execute on function public.submit_payment_claim(uuid, text, text) to authenticated;

-- -------------------------------------------------------------
-- 4. cancel_payment_claim() - client can withdraw their OWN
--    still-pending claim (e.g. picked the wrong plan).
-- -------------------------------------------------------------
create or replace function public.cancel_payment_claim(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.payments
    where id = p_payment_id and profile_id = auth.uid() and status = 'pending';

    if not found then
        raise exception 'No matching pending payment found';
    end if;
end;
$$;

grant execute on function public.cancel_payment_claim(uuid) to authenticated;

-- -------------------------------------------------------------
-- 5. admin_approve_payment() / admin_reject_payment() - the
--    super-admin side of the pending-claim flow. Approving extends
--    current_period_end by the CLAIM's plan duration, stacking on
--    top of any remaining time (a renewal keeps unused paid days).
-- -------------------------------------------------------------
create or replace function public.admin_approve_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment public.payments%rowtype;
    v_days integer;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_payment from public.payments where id = p_payment_id and status = 'pending';
    if v_payment.id is null then
        raise exception 'Pending payment not found';
    end if;

    select duration_days into v_days from public.plans where id = v_payment.plan_id;
    v_days := coalesce(v_days, 30);

    update public.payments set status = 'paid' where id = p_payment_id;

    update public.profiles
    set subscription_status = 'active',
        plan_id = coalesce(v_payment.plan_id, plan_id),
        current_period_end = greatest(coalesce(current_period_end, now()), now())
            + make_interval(days => v_days)
    where id = v_payment.profile_id;
end;
$$;

create or replace function public.admin_reject_payment(p_payment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    update public.payments
    set status = 'failed',
        reference = coalesce(reference, '') ||
            case when p_reason is not null then ' [rejected: ' || p_reason || ']' else ' [rejected]' end
    where id = p_payment_id and status = 'pending';

    if not found then
        raise exception 'Pending payment not found';
    end if;
end;
$$;

-- -------------------------------------------------------------
-- 6. admin_list_clients() / admin_list_payments() - surface pending
--    claims to the admin dashboard.
-- -------------------------------------------------------------
drop function if exists public.admin_list_clients();

create or replace function public.admin_list_clients()
returns table (
    id uuid,
    business_name text,
    email text,
    plan_id uuid,
    plan_name text,
    plan_slug text,
    subscription_status text,
    current_period_end timestamptz,
    pending_payment_id uuid,
    pending_amount numeric,
    pending_plan_name text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select
        p.id, p.business_name, p.email, p.plan_id, pl.name, pl.slug,
        p.subscription_status, p.current_period_end,
        pend.id, pend.amount, pend_plan.name,
        p.created_at
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    left join lateral (
        select * from public.payments pay
        where pay.profile_id = p.id and pay.status = 'pending'
        order by pay.created_at desc limit 1
    ) pend on true
    left join public.plans pend_plan on pend_plan.id = pend.plan_id
    where public.is_super_admin()
    order by (pend.id is not null) desc, p.created_at desc;
$$;

drop function if exists public.admin_list_payments(uuid);
create function public.admin_list_payments(p_profile uuid)
returns table (
    id uuid, amount numeric, method text, status text, reference text,
    plan_name text, created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select pay.id, pay.amount, pay.method, pay.status, pay.reference, pl.name, pay.created_at
    from public.payments pay
    left join public.plans pl on pl.id = pay.plan_id
    where pay.profile_id = p_profile and public.is_super_admin()
    order by pay.created_at desc;
$$;

-- -------------------------------------------------------------
-- 7. get_my_billing() - now reports the caller's own pending claim
--    (if any) and whether they've used the free trial, so the login
--    paywall knows exactly which screen to show.
-- -------------------------------------------------------------
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

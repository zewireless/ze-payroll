-- ============================================
-- ze-payroll: SaaS registration + subscription + super-admin migration
--
-- Adds the account layer that sits ABOVE the existing employees/dtr_entries
-- tables: a client signs up on register.html, picks one of the 3 plans
-- already advertised on the landing page (5-Day Trial / 3-Month / 6-Month),
-- and lands in a "profiles" row that tracks their subscription. One email
-- (set at the bottom of this file) is flagged is_super_admin = true and
-- gets access to admin.html, which can see every client and record
-- payments / change status - mirroring ze-pos's admin model.
--
-- IMPORTANT - SCOPE OF THIS MIGRATION:
-- This adds registration + billing ONLY. It does NOT yet make the
-- employees / dtr_entries / payroll_settings / app_config tables
-- multi-tenant - those still work exactly as before (one shared set of
-- rows, any authenticated admin can see them all). That's fine as long
-- as this Supabase project keeps serving ONE payroll business.
-- If you bring a SECOND real paying client onto this same Supabase
-- project, they would currently see the first client's employees too.
-- Don't onboard a second client with real data until that follow-up
-- migration (workspace_id on the payroll tables) is done - ask for it
-- explicitly when you're ready, since it touches live employee data
-- and the printed kiosk QR codes.
--
-- Run this in the Supabase SQL Editor as the `postgres` role, after
-- 001-008. Idempotent: safe to re-run.
-- ============================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- Plans - matches the 3 cards already on the landing page
-- (index.html #pricing). Edit price/duration here if you change
-- the landing page; admin.html reads from this table too.
-- -------------------------------------------------------------
create table if not exists public.plans (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,               -- 'trial' | '3mo' | '6mo'
    name text not null,
    price numeric(12,2) not null default 0,
    currency text not null default 'PHP',
    duration_days integer not null default 30,
    features text[] not null default '{}',
    sort_order integer not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

insert into public.plans (slug, name, price, currency, duration_days, features, sort_order)
select v.slug, v.name, v.price, 'PHP', v.duration_days, v.features, v.sort_order
from (values
    ('trial', '5-Day Trial', 0.00,   5,  array['Unlimited employees','QR & manual attendance','Automated payroll & payslips','PH statutory deductions'], 1),
    ('3mo',   '3-Month Plan', 399.00, 90, array['Unlimited employees','QR & manual attendance','Automated payroll & payslips','PH statutory deductions','Email support'], 2),
    ('6mo',   '6-Month Plan', 599.00, 180, array['Unlimited employees','QR & manual attendance','Automated payroll & payslips','PH statutory deductions','Priority email support'], 3)
) as v(slug, name, price, duration_days, features, sort_order)
where not exists (select 1 from public.plans where slug = v.slug);

-- -------------------------------------------------------------
-- Profiles - one row per Supabase auth user (= one client business)
-- -------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    business_name text not null default 'My Business',
    email text,
    is_super_admin boolean not null default false,
    plan_id uuid references public.plans(id),
    subscription_status text not null default 'trial'
        check (subscription_status in ('trial', 'active', 'overdue', 'cancelled')),
    current_period_end timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles (subscription_status);

-- -------------------------------------------------------------
-- Payments - manual GCash / Maya / bank proof, recorded by the
-- super-admin once they confirm the money actually came in. No
-- payment gateway needed to launch.
-- -------------------------------------------------------------
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id) on delete cascade,
    amount numeric(12,2) not null default 0,
    method text not null default 'gcash' check (method in ('gcash', 'maya', 'bank', 'other')),
    reference text,
    created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Auto-create a profile whenever someone signs up on register.html.
-- register.html passes business_name + plan_slug in the auth signUp
-- call's `options.data` (user metadata) - this trigger reads that.
-- Picking the "trial" plan activates immediately (current_period_end
-- = now + 5 days). Picking a paid plan leaves them 'overdue' (i.e.
-- "payment pending") until the super-admin confirms payment via
-- admin_record_payment(), which starts their period_end from that
-- moment - not from signup - so nobody's paid days tick away
-- while they're still arranging the GCash/bank transfer.
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan record;
    v_slug text;
begin
    v_slug := coalesce(new.raw_user_meta_data->>'plan_slug', 'trial');
    select * into v_plan from public.plans where slug = v_slug and active = true;
    if not found then
        select * into v_plan from public.plans where slug = 'trial';
    end if;

    insert into public.profiles (id, email, business_name, plan_id, subscription_status, current_period_end)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
        v_plan.id,
        case when v_plan.slug = 'trial' then 'trial' else 'overdue' end,
        case when v_plan.slug = 'trial' then now() + make_interval(days => v_plan.duration_days) else null end
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- Row-Level Security
-- -------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.payments enable row level security;

-- Anyone (even signed-out, for register.html's plan cards) can read
-- active plans - there's no pricing secret to protect.
drop policy if exists "anyone can read active plans" on public.plans;
create policy "anyone can read active plans" on public.plans
    for select
    to anon, authenticated
    using (active = true);

-- A client can read/update their OWN profile only (never anyone else's,
-- and never their own subscription_status/plan_id directly - those
-- change only through the admin RPCs below).
drop policy if exists "own profile only" on public.profiles;
create policy "own profile only" on public.profiles
    for select
    to authenticated
    using (id = auth.uid());

drop policy if exists "update own business name" on public.profiles;
create policy "update own business name" on public.profiles
    for update
    to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- A client can see their own payment history only.
drop policy if exists "own payments only" on public.payments;
create policy "own payments only" on public.payments
    for select
    to authenticated
    using (profile_id = auth.uid());

-- -------------------------------------------------------------
-- Admin helper + RPCs (SECURITY DEFINER -> bypass RLS, gated on
-- is_super_admin so only ev.lounel4195@gmail.com's account can
-- actually use them - see the claim at the bottom of this file).
-- -------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and is_super_admin = true
    );
$$;

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
    last_payment_at timestamptz,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select
        p.id, p.business_name, p.email, p.plan_id, pl.name, pl.slug,
        p.subscription_status, p.current_period_end,
        (select max(pay.created_at) from public.payments pay where pay.profile_id = p.id),
        p.created_at
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where public.is_super_admin()
    order by p.created_at desc;
$$;

create or replace function public.admin_list_payments(p_profile uuid)
returns table (
    id uuid, amount numeric, method text, reference text, created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select pay.id, pay.amount, pay.method, pay.reference, pay.created_at
    from public.payments pay
    where pay.profile_id = p_profile and public.is_super_admin()
    order by pay.created_at desc;
$$;

-- Record a confirmed manual payment. Extends current_period_end by the
-- CLIENT'S chosen plan's duration_days (90 for 3-Month, 180 for
-- 6-Month) from whichever is later: today, or their existing period
-- end (so renewing early stacks on top instead of wasting paid days).
create or replace function public.admin_record_payment(
    p_profile uuid,
    p_amount numeric,
    p_method text,
    p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_days integer;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select pl.duration_days into v_days
    from public.profiles pr join public.plans pl on pl.id = pr.plan_id
    where pr.id = p_profile;

    insert into public.payments (profile_id, amount, method, reference)
    values (p_profile, p_amount, p_method, p_reference);

    update public.profiles
    set subscription_status = 'active',
        current_period_end = greatest(coalesce(current_period_end, now()), now())
            + make_interval(days => coalesce(v_days, 30))
    where id = p_profile;
end;
$$;

-- Cancel / reactivate / mark overdue by hand.
create or replace function public.admin_set_subscription_status(p_profile uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if p_status not in ('trial', 'active', 'overdue', 'cancelled') then
        raise exception 'invalid status';
    end if;
    update public.profiles set subscription_status = p_status where id = p_profile;
end;
$$;

-- Move a client onto a different plan (e.g. upgrade trial -> 6-Month).
create or replace function public.admin_set_plan(p_profile uuid, p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    update public.profiles set plan_id = p_plan_id where id = p_profile;
end;
$$;

-- Manual day adjustment (goodwill extension, correcting a mistake, etc).
create or replace function public.admin_extend_period(p_profile uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    update public.profiles
    set current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => p_days)
    where id = p_profile;
end;
$$;

-- One-call billing snapshot for the signed-in client - app.js calls
-- this right after login to decide whether to show the dashboard or
-- a "your trial/subscription has ended" screen.
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
        'plan_name', plan.name,
        'plan_slug', plan.slug,
        'price', plan.price,
        'currency', plan.currency
    ) into result
    from public.profiles prof
    left join public.plans plan on plan.id = prof.plan_id
    where prof.id = auth.uid();

    return coalesce(result, '{}'::jsonb);
end;
$$;

-- -------------------------------------------------------------
-- LAST STEP - run this yourself, once, after you've registered an
-- account on register.html using ev.lounel4195@gmail.com. It can't
-- be part of the automated migration above because that auth user
-- doesn't exist yet the first time this file runs.
-- -------------------------------------------------------------
-- update public.profiles set is_super_admin = true
-- where email = 'ev.lounel4195@gmail.com';

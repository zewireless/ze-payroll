-- =============================================================
-- ze-payroll 019 — STRICT subscription enforcement.
--
-- Before: the paywall was only a pop-up in app.js. It failed open on
-- errors, trusted the device clock, could be closed by clicking outside
-- it / pressing Esc, and nothing stopped the database from serving an
-- expired client's data.
--
-- Worse: the "update own business name" policy on profiles (009) let a
-- signed-in client UPDATE ANY column of their own profile row from the
-- browser console - subscription_status, current_period_end,
-- trial_used, even is_super_admin. Part 1 below closes that.
--
-- Depends on get_my_billing() (017) and is_super_admin() (009).
-- Run in the Supabase SQL editor after 018. Idempotent.
--
-- !! BEFORE RUNNING: check admin.html (or the profiles table):
--   * YOUR OWN account must be is_super_admin = true, or status
--     'active' with a future current_period_end. 011 created the owner
--     profile as 'trial' with NO end date, which this rule rejects.
--   * Any real client with status 'trial' and no end date, or with no
--     profile row at all, will be locked out until you set them Active.
-- =============================================================

-- -------------------------------------------------------------
-- PART 1 - clients may only change their own business_name.
-- -------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;
revoke insert, delete on public.profiles from authenticated, anon;
grant  update (business_name) on public.profiles to authenticated;

-- -------------------------------------------------------------
-- PART 2 - server-side access check (uses the SERVER clock).
-- -------------------------------------------------------------
create or replace function public.has_active_access()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    b  jsonb;
    st text;
    pe timestamptz;
begin
    if auth.uid() is null then return false; end if;
    if public.is_super_admin() then return true; end if;

    begin
        b := public.get_my_billing()::jsonb;
    exception when others then
        return false;           -- strict: can't verify = no access
    end;
    if b is null or b = '{}'::jsonb then return false; end if;

    st := b->>'status';
    pe := nullif(b->>'period_end', '')::timestamptz;

    if st = 'active' then
        return pe is null or pe > now();
    elsif st = 'trial' then
        return pe is not null and pe > now();   -- a trial MUST have an end date
    end if;
    return false;               -- never / overdue / cancelled / anything else
end;
$$;

revoke all on function public.has_active_access() from public, anon;
grant execute on function public.has_active_access() to authenticated;

-- What app.js calls on login and every minute: billing info + the
-- server's verdict + the server's clock.
create or replace function public.check_my_access()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select coalesce(public.get_my_billing()::jsonb, '{}'::jsonb)
           || jsonb_build_object(
                'has_access', public.has_active_access(),
                'server_now', now()
              );
$$;

revoke all on function public.check_my_access() from public, anon;
grant execute on function public.check_my_access() to authenticated;

-- -------------------------------------------------------------
-- PART 3 - restrictive RLS: AND-ed with the existing workspace
-- policies, so it can only ever remove access. Billing tables (plans,
-- payments, payment_settings, profiles) are intentionally NOT covered
-- so a locked client can still see the plans and pay. The kiosk and
-- payslip portal use SECURITY DEFINER RPCs and are unaffected.
-- -------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array[
        'employees', 'dtr_entries', 'app_config',
        'payroll_settings', 'payroll_runs', 'payroll_adjustments'
    ] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop policy if exists "require active subscription" on public.%I', t);
            execute format(
                'create policy "require active subscription" on public.%I
                 as restrictive for all to authenticated
                 using ((select public.has_active_access()))
                 with check ((select public.has_active_access()))', t);
        end if;
    end loop;
end $$;

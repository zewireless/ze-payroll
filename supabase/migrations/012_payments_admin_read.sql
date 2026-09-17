-- =============================================================
-- ze-payroll 012 — let the super-admin's own session read every
-- row in `payments`, not just their own.
--
-- Why this is needed: admin.html's pending-subscriptions box calls
-- admin_list_clients(), a SECURITY DEFINER RPC that already bypasses
-- RLS — so the manual "Refresh" flow has always worked fine. But a
-- client-side Supabase Realtime subscription to postgres_changes on
-- `payments` runs as the SUBSCRIBER'S own role, and Realtime enforces
-- RLS for that role. The only existing policy on `payments`
-- ("own payments only", from 010_client_plan_selection.sql) scopes
-- rows to profile_id = auth.uid(), so a super-admin's browser tab
-- would receive zero INSERT/UPDATE events for other clients' claims.
--
-- This adds a second, purely additive SELECT policy (RLS policies
-- are OR'd together) so a super-admin's own auth session can also
-- see every row — unlocking realtime for admin.html without touching
-- what a regular client can see of their own account.
--
-- Run in the Supabase SQL editor, after 001-011. Idempotent.
-- =============================================================

drop policy if exists "admins can read all payments" on public.payments;
create policy "admins can read all payments" on public.payments
    for select
    to authenticated
    using (public.is_super_admin());

-- -------------------------------------------------------------
-- Also add `payments` to the realtime publication so postgres_changes
-- events fire for it at all. Safe to re-run — will no-op if it's
-- already a member.
-- -------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'payments'
    ) then
        alter publication supabase_realtime add table public.payments;
    end if;
end $$;

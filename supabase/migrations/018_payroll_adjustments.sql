-- =============================================================
-- ze-payroll 018 — sync payroll deduction adjustments across devices.
--
-- Problem: "Edit Deductions" (per employee, per pay period) was saved
-- ONLY in the browser's localStorage, so an edit made on a phone never
-- showed up in desktop Chrome (and vice versa).
--
-- Stored in Supabase, scoped to the owner's workspace
-- (workspace_id = auth.uid(), same pattern as 011 / 015).
--
-- Run in the Supabase SQL editor, after 017. Idempotent.
-- =============================================================

create table if not exists public.payroll_adjustments (
    workspace_id  uuid        not null default auth.uid(),
    employee_id   text        not null,
    period_start  date        not null,
    period_end    date        not null,
    adjustment    jsonb       not null default '{}'::jsonb,
    updated_at    timestamptz not null default now(),
    primary key (workspace_id, employee_id, period_start, period_end),
    foreign key (workspace_id, employee_id)
        references public.employees(workspace_id, id) on delete cascade
);

alter table public.payroll_adjustments enable row level security;

drop policy if exists "own workspace only" on public.payroll_adjustments;
create policy "own workspace only" on public.payroll_adjustments
    for all
    to authenticated
    using (workspace_id = auth.uid())
    with check (workspace_id = auth.uid());

grant select, insert, update, delete on public.payroll_adjustments to authenticated;

-- Live updates between devices (phone edit -> PC updates without refresh).
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'payroll_adjustments'
    ) then
        alter publication supabase_realtime add table public.payroll_adjustments;
    end if;
end $$;

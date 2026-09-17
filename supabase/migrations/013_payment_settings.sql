-- =============================================================
-- ze-payroll 013 — editable GCash / Maya / bank payment details
--
-- Right now the "send payment to..." text in app.js's plan picker
-- (renderPlanPicker) is hardcoded and points to "(details on the
-- pricing page)", which doesn't actually exist anywhere. This adds
-- a small table the super-admin can edit from admin.html, and that
-- app.js reads from to show clients where to actually send money.
-- =============================================================

create table if not exists public.payment_settings (
    method text primary key check (method in ('gcash', 'maya', 'bank')),
    account_name text not null default '',
    account_number text not null default '',
    note text,                          -- e.g. bank name/branch, or QR-only instructions
    updated_at timestamptz not null default now()
);

alter table public.payment_settings enable row level security;

-- Any logged-in client needs to read these to know where to send
-- payment in the plan picker.
drop policy if exists "authenticated can read payment settings" on public.payment_settings;
create policy "authenticated can read payment settings" on public.payment_settings
    for select
    to authenticated
    using (true);

-- No direct insert/update/delete policy — writes only happen through
-- admin_update_payment_settings() below, same pattern as plans.

create or replace function public.admin_update_payment_settings(
    p_method text,
    p_account_name text,
    p_account_number text,
    p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if p_method not in ('gcash', 'maya', 'bank') then
        raise exception 'invalid method';
    end if;

    insert into public.payment_settings (method, account_name, account_number, note, updated_at)
    values (p_method, trim(p_account_name), trim(p_account_number), nullif(trim(coalesce(p_note, '')), ''), now())
    on conflict (method) do update
        set account_name = excluded.account_name,
            account_number = excluded.account_number,
            note = excluded.note,
            updated_at = now();
end;
$$;

-- Seed the three rows so admin.html has something to edit right away
-- and app.js's picker never renders blank fields.
insert into public.payment_settings (method, account_name, account_number, note)
values
    ('gcash', 'Set me in Super Admin', '09XX XXX XXXX', null),
    ('maya',  'Set me in Super Admin', '09XX XXX XXXX', null),
    ('bank',  'Set me in Super Admin', 'XXXX-XXXX-XXXX', 'Bank name / branch')
on conflict (method) do nothing;

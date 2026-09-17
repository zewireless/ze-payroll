-- =============================================================
-- ze-payroll 014 — employee payment details (how each employee
-- actually gets paid: cash, bank transfer, GCash, or Maya).
--
-- Not to be confused with public.payment_settings (013), which is
-- the *client's own* GCash/Maya/bank details for paying their
-- ze-payroll subscription. This is per-employee, per-workspace data:
-- where THIS employee's salary should be sent. It's shown on the
-- printed/portal payslip so the employee can confirm it's correct,
-- and gives the admin one place (the existing employee form) to
-- keep it instead of a side spreadsheet.
--
-- employees is already workspace-isolated with RLS from 011, so no
-- new policy is needed here - these are just new columns on an
-- already-protected table.
-- =============================================================

alter table public.employees
    add column if not exists payment_method text not null default 'cash'
        check (payment_method in ('cash', 'bank', 'gcash', 'maya')),
    add column if not exists payment_account_name text default '',
    add column if not exists payment_account_number text default '',
    add column if not exists payment_note text default '';  -- e.g. bank name/branch

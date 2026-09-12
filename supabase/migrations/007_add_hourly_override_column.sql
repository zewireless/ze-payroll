-- ============================================
-- ze-payroll: add hourly_override column to dtr_entries
--
-- Lets an admin flag a specific day (via Edit DTR Entry) to be paid by
-- actual hours worked instead of the flat full/half-day rate - e.g. an
-- undertime day (arrived late AND left early) where a full or half
-- day's flat pay would overpay for the hours actually worked.
--
-- This only changes how the BASE pay for that day is computed
-- (app.js: computeEmployeePayroll). Late deduction and overtime are
-- untouched either way - they're already calculated per-entry from
-- late_minutes / ot_hours regardless of this flag.
--
-- Run this in the Supabase SQL Editor as the `postgres` role, after
-- 006_am_pm_half_day_windows.sql. Idempotent: safe to re-run.
-- ============================================

alter table public.dtr_entries
    add column if not exists hourly_override boolean not null default false;

comment on column public.dtr_entries.hourly_override is
    'When true, payroll pays this day at (total_hours - ot_hours) * hourly rate instead of a flat full/half-day rate. Set manually via Edit DTR Entry. Late deduction and OT are unaffected.';

create table if not exists public.purchase_budgets (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 unit_id uuid not null references public.units(id) on delete cascade,
 budget_month date not null,
 category text,
 budget_amount numeric not null check (budget_amount >= 0),
 created_by uuid not null default auth.uid() references auth.users(id),
 updated_at timestamptz not null default now(),
 unique(company_id,unit_id,budget_month,category)
);
alter table public.purchase_budgets enable row level security;
create policy purchase_budgets_select on public.purchase_budgets for select to authenticated using (private.has_unit_access(unit_id,array['admin','manager']::text[]));
create policy purchase_budgets_manage_admin on public.purchase_budgets for all to authenticated using (private.has_unit_access(unit_id,array['admin']::text[])) with check (private.has_unit_access(unit_id,array['admin']::text[]));
grant select,insert,update,delete on public.purchase_budgets to authenticated;

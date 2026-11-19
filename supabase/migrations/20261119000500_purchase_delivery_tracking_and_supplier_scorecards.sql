alter table public.purchase_orders add column if not exists expected_delivery_date date;
alter table public.purchase_orders add column if not exists supplier_delivery_notes text;
create table if not exists public.supplier_order_evaluations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 unit_id uuid not null references public.units(id) on delete cascade,
 order_id uuid not null unique references public.purchase_orders(id) on delete cascade,
 supplier_id uuid not null references public.suppliers(id),
 punctuality_score integer not null check (punctuality_score between 1 and 5),
 quality_score integer not null check (quality_score between 1 and 5),
 completeness_score integer not null check (completeness_score between 1 and 5),
 communication_score integer not null check (communication_score between 1 and 5),
 comments text,
 evaluated_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.supplier_order_evaluations enable row level security;
create policy supplier_eval_select on public.supplier_order_evaluations for select to authenticated using (private.has_unit_access(unit_id,array['admin','manager']::text[]));
create policy supplier_eval_insert on public.supplier_order_evaluations for insert to authenticated with check (private.has_unit_access(unit_id,array['admin','manager']::text[]) and evaluated_by=auth.uid());
create policy supplier_eval_update on public.supplier_order_evaluations for update to authenticated using (private.has_unit_access(unit_id,array['admin','manager']::text[])) with check (private.has_unit_access(unit_id,array['admin','manager']::text[]) and evaluated_by=auth.uid());
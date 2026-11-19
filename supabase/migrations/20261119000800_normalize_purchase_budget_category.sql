update public.purchase_budgets set category='' where category is null;
alter table public.purchase_budgets alter column category set default '';
alter table public.purchase_budgets alter column category set not null;
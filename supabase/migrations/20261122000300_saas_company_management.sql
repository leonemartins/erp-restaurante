alter table public.companies
  add column if not exists status text not null default 'active'
    check (status in ('active','suspended'));
alter table public.companies
  add column if not exists plan text not null default 'trial'
    check (plan in ('trial','basic','professional','enterprise'));
alter table public.companies
  add column if not exists billing_status text not null default 'trial'
    check (billing_status in ('trial','current','overdue','cancelled'));
alter table public.companies add column if not exists trial_ends_at timestamptz;
alter table public.companies add column if not exists updated_at timestamptz not null default now();

-- Permite que a função administrativa segura atualize os dados SaaS das empresas.
grant update on table public.companies to service_role;

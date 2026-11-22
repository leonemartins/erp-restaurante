create table if not exists public.saas_plans (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code in ('trial','basic','professional','enterprise')),
 name text not null,
 monthly_price numeric(12,2) check (monthly_price is null or monthly_price >= 0),
 billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
 active boolean not null default true,
 description text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.company_subscriptions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 plan_id uuid not null references public.saas_plans(id) on delete restrict,
 status text not null default 'trial' check (status in ('trial','active','overdue','cancelled')),
 started_at date not null default current_date,
 trial_ends_at date,
 current_period_start date,
 current_period_end date,
 next_due_date date,
 cancelled_at timestamptz,
 notes text,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists company_subscriptions_one_open_per_company
 on public.company_subscriptions(company_id) where status in ('trial','active','overdue');
create index if not exists company_subscriptions_due_idx on public.company_subscriptions(next_due_date) where status in ('active','overdue');
create table if not exists public.company_payments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 subscription_id uuid references public.company_subscriptions(id) on delete set null,
 amount numeric(12,2) not null check (amount > 0),
 due_date date not null,
 paid_at timestamptz,
 status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
 payment_method text check (payment_method is null or payment_method in ('pix','boleto','credit_card','bank_transfer','cash','other')),
 reference text,
 notes text,
 recorded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists company_payments_company_due_idx on public.company_payments(company_id,due_date desc);
alter table public.saas_plans enable row level security;
alter table public.company_subscriptions enable row level security;
alter table public.company_payments enable row level security;
revoke all on public.saas_plans,public.company_subscriptions,public.company_payments from anon,authenticated;
grant select,insert,update,delete on public.saas_plans,public.company_subscriptions,public.company_payments to service_role;
insert into public.saas_plans(code,name,monthly_price,billing_cycle,description)
values ('trial','Avaliação',null,'monthly','Período de avaliação gratuita'),
 ('basic','Básico',null,'monthly','Plano inicial GestorPro'),
 ('professional','Profissional',null,'monthly','Plano profissional GestorPro'),
 ('enterprise','Enterprise',null,'monthly','Plano corporativo GestorPro')
on conflict(code) do nothing;
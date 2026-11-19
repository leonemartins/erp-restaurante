alter table public.supplier_quote_prices add column if not exists freight_amount numeric not null default 0 check (freight_amount >= 0);
alter table public.supplier_quote_prices add column if not exists delivery_days integer check (delivery_days is null or delivery_days >= 0);
alter table public.supplier_quote_prices add column if not exists payment_terms text;
comment on column public.supplier_quote_prices.freight_amount is 'Frete informado pelo fornecedor para a cotação.';
comment on column public.supplier_quote_prices.delivery_days is 'Prazo de entrega informado em dias.';
comment on column public.supplier_quote_prices.payment_terms is 'Condição de pagamento informada pelo fornecedor.';
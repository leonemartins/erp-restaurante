-- Devolução rastreável de peças de manutenção ao estoque
-- Aplicada no projeto erp-restaurante.

create table if not exists public.maintenance_part_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  part_use_id uuid not null references public.maintenance_parts_used(id),
  original_exit_movement_id uuid not null references public.stock_movements(id),
  stock_entry_movement_id uuid not null references public.stock_movements(id),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  reason text not null,
  returned_by uuid not null references auth.users(id),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint maintenance_part_returns_entry_unique unique (stock_entry_movement_id)
);

create index if not exists idx_maintenance_part_returns_part_use
  on public.maintenance_part_returns(part_use_id, created_at);

alter table public.maintenance_part_returns enable row level security;

drop policy if exists maintenance_part_returns_select on public.maintenance_part_returns;
create policy maintenance_part_returns_select
  on public.maintenance_part_returns for select to authenticated
  using (private.has_unit_access(unit_id,array['admin','manager','employee']::text[]));

grant select on public.maintenance_part_returns to authenticated;
revoke insert, update, delete on public.maintenance_part_returns from anon, authenticated;

create or replace function public.return_maintenance_part_to_stock(
  p_part_use_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_part public.maintenance_parts_used%rowtype;
  v_work_order public.maintenance_work_orders%rowtype;
  v_original public.stock_movements%rowtype;
  v_returned numeric;
  v_return_id uuid;
  v_entry_id uuid;
begin
  if v_user is null then raise exception 'Usuário não autenticado.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'A quantidade devolvida deve ser maior que zero.'; end if;
  if p_idempotency_key is null then raise exception 'Chave de idempotência obrigatória.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Informe o motivo da devolução.'; end if;

  select id into v_return_id from public.maintenance_part_returns where idempotency_key=p_idempotency_key;
  if v_return_id is not null then return v_return_id; end if;

  select * into v_part from public.maintenance_parts_used where id=p_part_use_id for update;
  if not found then raise exception 'Registro de peça utilizada não encontrado.'; end if;
  if not private.has_unit_access(v_part.unit_id,array['admin','manager','employee']::text[]) then
    raise exception 'Usuário sem acesso à unidade desta ordem de serviço.';
  end if;
  if v_part.product_id is null or v_part.stock_movement_id is null then
    raise exception 'Esta peça não possui produto e saída original vinculados ao estoque; não é possível realizar a devolução automática.';
  end if;

  select * into v_work_order from public.maintenance_work_orders
   where id=v_part.work_order_id and company_id=v_part.company_id and unit_id=v_part.unit_id;
  if not found then raise exception 'Ordem de serviço incompatível com a empresa ou unidade da peça.'; end if;

  select * into v_original from public.stock_movements
   where id=v_part.stock_movement_id and company_id=v_part.company_id
     and unit_id=v_part.unit_id and product_id=v_part.product_id
     and movement_type='exit' for update;
  if not found then raise exception 'A movimentação original de saída não foi localizada ou não corresponde a esta peça.'; end if;

  select coalesce(sum(quantity),0) into v_returned
    from public.maintenance_part_returns where part_use_id=v_part.id;
  if p_quantity>(v_original.quantity-v_returned) then
    raise exception 'Quantidade excede o saldo disponível para devolução. Retirada: %, já devolvida: %, disponível: %.',
      v_original.quantity,v_returned,greatest(v_original.quantity-v_returned,0);
  end if;

  v_entry_id:=public.register_stock_movement(
    v_part.company_id,v_part.unit_id,v_part.product_id,'entry',
    p_quantity,v_original.unit_cost,
    'Devolução de peça não utilizada na OS '||v_work_order.order_number::text||
      '. Saída original: '||v_original.id::text||'. Motivo: '||btrim(p_reason),
    null,p_idempotency_key
  );

  insert into public.maintenance_part_returns(
    company_id,unit_id,part_use_id,original_exit_movement_id,
    stock_entry_movement_id,quantity,unit_cost,reason,returned_by,idempotency_key
  ) values (
    v_part.company_id,v_part.unit_id,v_part.id,v_original.id,
    v_entry_id,p_quantity,v_original.unit_cost,btrim(p_reason),v_user,p_idempotency_key
  ) returning id into v_return_id;

  return v_return_id;
end;
$function$;

revoke all on function public.return_maintenance_part_to_stock(uuid,numeric,text,uuid) from public,anon;
grant execute on function public.return_maintenance_part_to_stock(uuid,numeric,text,uuid) to authenticated;

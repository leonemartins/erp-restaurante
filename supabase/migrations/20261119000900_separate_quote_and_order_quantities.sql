alter table public.purchase_quote_items
 add column if not exists order_quantity numeric;
comment on column public.purchase_quote_items.order_quantity is 'Quantidade definida pelo gerente para o pedido após a seleção do fornecedor vencedor.';
create or replace function public.generate_purchase_orders_from_quote(p_quote_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_quote record;
 v_supplier record;
 v_order_id uuid;
 v_count integer:=0;
 v_total numeric;
begin
 if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
 select q.* into v_quote from public.purchase_quotes q where q.id=p_quote_id for update;
 if not found then raise exception 'Cotação não encontrada.'; end if;
 if not private.has_unit_access(v_quote.unit_id,array['admin','manager']) then
   raise exception 'Sem permissão para gerar pedidos desta unidade.';
 end if;
 if v_quote.status not in ('in_progress','completed','awarded') then
   raise exception 'A cotação não está em situação que permita gerar pedidos.';
 end if;
 if not exists(select 1 from public.purchase_quote_items where quote_id=p_quote_id and winner_supplier_id is not null) then
   raise exception 'Defina os fornecedores vencedores antes de gerar os pedidos.';
 end if;
 if exists(select 1 from public.purchase_quote_items where quote_id=p_quote_id and winner_supplier_id is not null and (order_quantity is null or order_quantity<=0)) then
   raise exception 'Informe uma quantidade de pedido maior que zero para cada item vencedor.';
 end if;
 for v_supplier in
   select distinct qi.winner_supplier_id supplier_id from public.purchase_quote_items qi
   where qi.quote_id=p_quote_id and qi.winner_supplier_id is not null
 loop
   if exists(select 1 from public.purchase_orders po where po.quote_id=p_quote_id and po.supplier_id=v_supplier.supplier_id) then continue; end if;
   select coalesce(sum(qi.order_quantity*sp.unit_price),0) into v_total
   from public.purchase_quote_items qi join public.supplier_quote_prices sp on sp.quote_item_id=qi.id and sp.supplier_id=v_supplier.supplier_id
   where qi.quote_id=p_quote_id and qi.winner_supplier_id=v_supplier.supplier_id;
   insert into public.purchase_orders(company_id,unit_id,supplier_id,quote_id,status,total_amount,notes,created_by)
   values(v_quote.company_id,v_quote.unit_id,v_supplier.supplier_id,p_quote_id,'pending_approval',v_total,'Gerado automaticamente a partir da cotação '||v_quote.title,auth.uid())
   returning id into v_order_id;
   insert into public.purchase_order_items(order_id,product_id,quantity,unit_price)
   select v_order_id,qi.product_id,qi.order_quantity,sp.unit_price
   from public.purchase_quote_items qi join public.supplier_quote_prices sp on sp.quote_item_id=qi.id and sp.supplier_id=v_supplier.supplier_id
   where qi.quote_id=p_quote_id and qi.winner_supplier_id=v_supplier.supplier_id;
   v_count:=v_count+1;
 end loop;
 update public.purchase_quotes set status='awarded' where id=p_quote_id;
 return v_count;
end;
$function$;
grant execute on function public.generate_purchase_orders_from_quote(uuid) to authenticated;
revoke all on function public.generate_purchase_orders_from_quote(uuid) from public,anon;
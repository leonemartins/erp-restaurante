-- Permissões SQL para as tabelas do fluxo de compras.
-- As políticas RLS continuam sendo aplicadas após estes GRANTs.
grant select, insert, update on public.purchase_requests to authenticated;
grant select, insert, update on public.purchase_request_items to authenticated;
grant select, insert, update, delete on public.purchase_approval_limits to authenticated;
grant select on public.purchase_approval_events to authenticated;
grant select, insert, update on public.supplier_order_evaluations to authenticated;

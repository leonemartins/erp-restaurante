ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text;

COMMENT ON COLUMN public.products.barcode IS
  'Código de barras comercial do produto, armazenado como texto para preservar zeros à esquerda.';

CREATE UNIQUE INDEX IF NOT EXISTS products_company_barcode_uidx
  ON public.products (company_id, btrim(barcode))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS products_company_barcode_lookup_idx
  ON public.products (company_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

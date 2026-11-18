-- Facturación ARCA: el comprobante lleva el IMPORTE COBRADO (contrato v0.12.0, §22.4 y P-66).
--
-- El comercio redondea el efectivo (generalmente hacia abajo) y maneja precios sin centavos: la factura
-- sale por lo que el cliente pagó. Hasta ahora fiscal_documents exigía el total exacto de la venta; desde
-- esta migración exige total_amount + rounding_amount (= lo cobrado) y recalcula el neto y el IVA por
-- alícuota sobre ese importe.
--
-- Cambio ADITIVO sobre lo ya aplicado: solo se reemplazan dos funciones (create or replace). Sin
-- tablas ni columnas nuevas, y no toca ninguna fila (con el ambiente en 'off' no hay comprobantes).
-- Cuando la venta no tiene redondeo, los importes son los de los ítems, exactamente como antes.
--
-- Cómo se reparte el redondeo entre alícuotas (determinista, en centavos):
--   1. cobrado = total_amount + rounding_amount;
--   2. la diferencia (cobrado − Σ importes brutos por alícuota) se reparte proporcionalmente al bruto de
--      cada alícuota; la última alícuota absorbe el resto de centavos, así la suma da el cobrado exacto;
--   3. de cada bruto ajustado: base = round(bruto / (1 + tasa), 2) e IVA = bruto − base.

-- ---------------------------------------------------------------------------
-- 1. Verificación al crear: importes = lo cobrado, y el desglose por alícuota cierra con el neto y el IVA
-- ---------------------------------------------------------------------------
create or replace function private.fiscal_documents_check_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_env text;
  v_sale public.sales;
  v_original public.fiscal_documents;
  v_sum_base numeric;
  v_sum_vat numeric;
begin
  if new.status <> 'pending' then
    perform private.raise_business_error('INVALID_FISCAL_DOCUMENT');
  end if;
  select environment into v_env from public.fiscal_settings;
  if v_env is null or v_env = 'off' or new.environment <> v_env then
    perform private.raise_business_error('FISCAL_DISABLED');
  end if;
  select * into v_sale from public.sales where id = new.sale_id;
  if not found then
    perform private.raise_business_error('SALE_NOT_FOUND');
  end if;

  -- El comprobante lleva lo cobrado (total + redondeo) y su desglose por alícuota suma el neto y el IVA.
  select coalesce(sum((e ->> 'base')::numeric), 0), coalesce(sum((e ->> 'amount')::numeric), 0)
    into v_sum_base, v_sum_vat
  from jsonb_array_elements(new.iva_breakdown) e;
  if new.imp_total <> v_sale.total_amount + v_sale.rounding_amount
     or v_sum_base <> new.imp_neto or v_sum_vat <> new.imp_iva then
    perform private.raise_business_error('FISCAL_AMOUNT_MISMATCH');
  end if;

  if new.kind = 'invoice' and v_sale.status <> 'completed' then
    perform private.raise_business_error('SALE_VOIDED');
  end if;
  if new.kind = 'credit_note' then
    select * into v_original from public.fiscal_documents where id = new.original_document_id;
    if not found or v_original.kind <> 'invoice' or v_original.status <> 'authorized'
       or v_original.sale_id <> new.sale_id or v_original.environment <> new.environment
       or v_original.pto_vta <> new.pto_vta or new.cbte_tipo <> v_original.cbte_tipo + 2 then
      perform private.raise_business_error('INVALID_FISCAL_DOCUMENT');
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. fiscal_begin: arma los importes sobre lo cobrado
-- ---------------------------------------------------------------------------
create or replace function public.fiscal_begin(
  p_idempotency_key uuid,
  p_sale_id uuid,
  p_kind text,
  p_cbte_tipo smallint,
  p_arca_last bigint,
  p_created_by uuid,
  p_receiver_doc_type smallint default 99,
  p_receiver_doc_number text default '0',
  p_receiver_vat_condition_id smallint default 5,
  p_original_document_id uuid default null
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.fiscal_settings;
  v_doc public.fiscal_documents;
  v_sale public.sales;
  v_unsupported int;
  v_next bigint;
  v_charged numeric(12, 2);
  v_gross_total numeric(12, 2);
  v_delta numeric(12, 2);
  v_allocated numeric(12, 2) := 0;
  v_groups_total int;
  v_n int := 0;
  v_group record;
  v_gross numeric(12, 2);
  v_base numeric(12, 2);
  v_vat numeric(12, 2);
  v_share numeric(12, 2);
  v_items jsonb := '[]'::jsonb;
  v_neto numeric(12, 2) := 0;
  v_iva numeric(12, 2) := 0;
begin
  select * into v_settings from public.fiscal_settings;
  if v_settings.environment is null or v_settings.environment = 'off' then
    perform private.raise_business_error('FISCAL_DISABLED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);
  perform pg_advisory_xact_lock(
    hashtextextended('fiscal:' || v_settings.environment || ':' || v_settings.pto_vta || ':' || p_cbte_tipo, 0)
  );

  -- Reintento: misma clave y misma venta devuelve el documento ya creado.
  select * into v_doc from public.fiscal_documents where idempotency_key = p_idempotency_key;
  if found then
    if v_doc.sale_id = p_sale_id and v_doc.kind = p_kind then
      return v_doc;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  -- Si la venta ya tiene un comprobante vivo de ese tipo, se devuelve (se retoma, no se duplica).
  select * into v_doc from public.fiscal_documents
  where sale_id = p_sale_id and kind = p_kind and status in ('pending', 'authorized', 'unknown');
  if found then
    return v_doc;
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    perform private.raise_business_error('SALE_NOT_FOUND');
  end if;

  select count(*) filter (where i.vat_rate not in (10.50, 21.00)) into v_unsupported
  from public.sale_items i where i.sale_id = p_sale_id;
  if v_unsupported > 0 then
    perform private.raise_business_error('FISCAL_UNSUPPORTED_VAT');
  end if;

  -- Importe del comprobante = lo cobrado (total + redondeo del efectivo).
  v_charged := v_sale.total_amount + v_sale.rounding_amount;
  select sum(i.net_amount + i.vat_amount), count(distinct i.vat_rate)
    into v_gross_total, v_groups_total
  from public.sale_items i where i.sale_id = p_sale_id;
  v_delta := v_charged - v_gross_total;

  for v_group in
    select i.vat_rate as rate, sum(i.net_amount) as base, sum(i.vat_amount) as vat
    from public.sale_items i where i.sale_id = p_sale_id
    group by i.vat_rate order by i.vat_rate
  loop
    v_n := v_n + 1;
    if v_delta = 0 then
      -- Sin redondeo: los importes de los ítems, tal cual.
      v_base := v_group.base;
      v_vat := v_group.vat;
    else
      v_gross := v_group.base + v_group.vat;
      -- El redondeo se reparte proporcionalmente al bruto; la última alícuota absorbe el resto de centavos.
      if v_n = v_groups_total then
        v_share := v_delta - v_allocated;
      else
        v_share := round(v_delta * v_gross / v_gross_total, 2);
        v_allocated := v_allocated + v_share;
      end if;
      v_gross := v_gross + v_share;
      v_base := round(v_gross / (1 + v_group.rate / 100), 2);
      v_vat := v_gross - v_base;
    end if;
    v_neto := v_neto + v_base;
    v_iva := v_iva + v_vat;
    v_items := v_items || jsonb_build_object(
      'id', case when v_group.rate = 10.50 then 4 else 5 end,
      'rate', v_group.rate,
      'base', v_base,
      'amount', v_vat
    );
  end loop;

  select greatest(coalesce(p_arca_last, 0), coalesce(max(d.cbte_nro), 0)) + 1 into v_next
  from public.fiscal_documents d
  where d.environment = v_settings.environment and d.pto_vta = v_settings.pto_vta and d.cbte_tipo = p_cbte_tipo
    and d.status <> 'rejected';

  insert into public.fiscal_documents (
    sale_id, kind, original_document_id, cbte_tipo, pto_vta, cbte_nro, environment,
    receiver_doc_type, receiver_doc_number, receiver_vat_condition_id,
    imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by
  )
  values (
    p_sale_id, p_kind, p_original_document_id, p_cbte_tipo, v_settings.pto_vta, v_next, v_settings.environment,
    coalesce(p_receiver_doc_type, 99), coalesce(p_receiver_doc_number, '0'), coalesce(p_receiver_vat_condition_id, 5),
    v_charged, v_neto, v_iva, v_items, p_idempotency_key, p_created_by
  )
  returning * into v_doc;

  return v_doc;
end;
$$;

-- create or replace conserva los permisos (solo service_role); se reafirman por claridad.
revoke all on function public.fiscal_begin(uuid, uuid, text, smallint, bigint, uuid, smallint, text, smallint, uuid) from public, anon, authenticated;
grant execute on function public.fiscal_begin(uuid, uuid, text, smallint, bigint, uuid, smallint, text, smallint, uuid) to service_role;

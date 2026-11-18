-- Facturación ARCA: reserva atómica del envío (contrato v0.12.0, §22.3).
--
-- Problema que resuelve: si dos pedidos simultáneos llegan sobre la misma venta, ambos podrían mandar el
-- mismo comprobante a ARCA. Uno obtendría el CAE y el otro un rechazo por número repetido; si el rechazo
-- se guardara primero, el CAE ya emitido quedaría sin registrar. Con fiscal_claim solo UNO pasa a enviar:
-- el resto ve que ya se envió y espera o concilia (consulta a ARCA) sin reenviar.
--
-- Cambio ADITIVO: una columna nueva (sent_at, nula; no toca filas), un create or replace del trigger de
-- actualización y una función nueva. Con el ambiente fiscal en 'off' no existe ningún documento.

alter table public.fiscal_documents add column sent_at timestamptz;

comment on column public.fiscal_documents.sent_at is
  'Cuándo se reservó el envío a ARCA (fiscal_claim). Nulo = todavía no se envió. Sirve para saber si un pending/unknown es reciente (en vuelo) o viejo (hay que conciliar).';

-- El trigger de actualización ahora admite que cambie sent_at, y la reserva (pending -> pending solo con sent_at).
create or replace function private.fiscal_documents_check_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changing text[] := array['status', 'cae', 'cae_expires_on', 'request_payload', 'response_payload', 'observations', 'authorized_at', 'sent_at'];
begin
  if old.status in ('authorized', 'rejected') then
    perform private.raise_business_error('FISCAL_DOCUMENT_IMMUTABLE');
  end if;
  if (to_jsonb(new) - v_changing) is distinct from (to_jsonb(old) - v_changing) then
    perform private.raise_business_error('FISCAL_DOCUMENT_IMMUTABLE');
  end if;
  -- Reservar el envío: el documento sigue pending y solo se completa sent_at (una sola vez).
  if old.status = 'pending' and new.status = 'pending'
     and (to_jsonb(new) - 'sent_at') is not distinct from (to_jsonb(old) - 'sent_at') then
    if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
      perform private.raise_business_error('FISCAL_DOCUMENT_IMMUTABLE');
    end if;
    return new;
  end if;
  if not ((old.status = 'pending' and new.status in ('authorized', 'rejected', 'unknown'))
       or (old.status = 'unknown' and new.status in ('authorized', 'rejected', 'unknown'))) then
    perform private.raise_business_error('INVALID_FISCAL_TRANSITION');
  end if;
  return new;
end;
$$;

-- true si ESTA llamada reservó el envío; false si otra ya lo hizo (o el documento ya no está pendiente).
create function public.fiscal_claim(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed uuid;
begin
  update public.fiscal_documents
     set sent_at = now()
   where id = p_document_id and status = 'pending' and sent_at is null
   returning id into v_claimed;
  return v_claimed is not null;
end;
$$;

revoke all on function public.fiscal_claim(uuid) from public, anon, authenticated;
grant execute on function public.fiscal_claim(uuid) to service_role;

comment on function public.fiscal_claim(uuid) is
  'Reserva el envío de un comprobante pendiente a ARCA. true = esta llamada envía; false = otra ya lo reservó. Solo service_role. Contrato §22.3.';

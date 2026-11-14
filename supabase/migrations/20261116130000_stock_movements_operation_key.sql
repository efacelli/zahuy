-- v0.4 paso D: clave de operación en los movimientos de stock.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 5.7 y 8.7.
--
-- register_product_movement puede repartir una salida entre varios lotes y
-- generar un movimiento por lote. Todos comparten operation_key, que es la
-- clave de idempotencia que envía el cliente para la operación completa; cada
-- movimiento conserva su propio idempotency_key.
--
-- Migración aditiva. Filas existentes: operation_key queda en NULL (son
-- movimientos de un solo lote, identificados por su idempotency_key).

alter table public.stock_movements
  add column operation_key uuid;

comment on column public.stock_movements.operation_key is
  'Clave de la operación de register_product_movement; la comparten los movimientos de una misma salida. NULL en el resto.';

create index stock_movements_operation_key_idx
  on public.stock_movements (operation_key)
  where operation_key is not null;

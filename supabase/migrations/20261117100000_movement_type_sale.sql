-- Etapa 5 (ventas y caja), paso 1 de 5: tipo de movimiento `sale`.
-- Contrato: docs/DATA_CONTRACT.md v0.6.3, §15.2.
--
-- Va sola en su propio archivo porque un valor nuevo de un enum no se puede
-- usar en la misma transacción en la que se agrega (igual que `internal_use`).
-- Migración aditiva: no modifica datos. `signed_quantity` no cambia: `sale` no
-- está en la lista de entradas, así que resta.
alter type public.movement_type add value if not exists 'sale';

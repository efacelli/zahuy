-- v0.7.1 (P-44): rol "Programador" (developer) con los mismos permisos que el dueño.
-- Sola en su archivo: un valor nuevo de enum no se puede usar en la misma
-- transacción en que se agrega. No modifica ni borra datos.
alter type public.app_role add value if not exists 'developer';

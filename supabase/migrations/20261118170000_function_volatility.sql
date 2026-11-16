-- Higiene de funciones: volatilidad correcta (avisos de `supabase db lint`).
--
-- Solo cambia la marca de volatilidad de dos funciones auxiliares; no toca tablas, datos ni
-- permisos y no cambia ningún resultado.
--
--   * private.assert_price_increase_args estaba marcada IMMUTABLE pero llama a una función que
--     puede lanzar un error de negocio: pasa a STABLE (depende de nada más que de sus argumentos, pero no
--     es constante en el tiempo de planificación). Marcarla inmutable dejaba abierta la posibilidad de
--     que el planificador la evaluara antes de tiempo.
--   * private.raise_business_error no tiene efectos secundarios más allá de lanzar el error:
--     se marca STABLE para que las funciones de LECTURA que la usan (preview_price_increase,
--     product_sales_ranking) sean realmente STABLE sin avisos del linter.
alter function private.assert_price_increase_args(uuid[], uuid[], uuid[], uuid[], numeric, numeric) stable;
alter function private.raise_business_error(text) stable;

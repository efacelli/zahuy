-- v0.4.4: P-21 (mermas del mes netas de anulaciones y a costo) y P-22 (auditar
-- el borrado de configuraciones de alertas). Contrato §5.8, §5.9, §7.4 y §13.
-- Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select col_type_is('public', 'v_inventory_summary', 'shrinkage_value_month', 'numeric(14,2)',
  'shrinkage_value_month es numeric(14,2)');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_inventory_summary'),
  array['active_products', 'low_stock_products', 'expiring_products', 'expired_batches', 'stock_value_cost',
        'stock_value_sale', 'shrinkage_quantity_month', 'box_mismatch_products', 'shrinkage_value_month'],
  'v_inventory_summary conserva el orden de columnas y suma shrinkage_value_month al final'
);
select ok(
  has_table_privilege('authenticated', 'public.v_inventory_summary', 'select')
  and not has_table_privilege('anon', 'public.v_inventory_summary', 'select'),
  'la vista conserva sus permisos'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000015a1', 'pia.encargada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000015a2', 'teo.empleado@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000015a1';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000015c1', 'Categoría P21');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000015b1', 'Marca P21');

create temporary table t_s (step int primary key, qty numeric, value numeric) on commit drop;
create temporary table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_s, t_ids to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000015a1", "role": "authenticated"}', true);
set local role authenticated;

insert into t_s select 1, shrinkage_quantity_month, shrinkage_value_month from public.v_inventory_summary;

insert into t_ids select 'p', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-0000000015e1', p_name => 'Galletitas P21',
  p_category_id => '00000000-0000-4000-8000-0000000015c1', p_brand_id => '00000000-0000-4000-8000-0000000015b1',
  p_sale_unit => 'unit', p_cost_price => 250, p_sale_price => 400, p_vat_rate => 21,
  p_initial_quantity => 50, p_expires_on => (now() at time zone 'America/Argentina/Buenos_Aires')::date + 60)).id;

insert into t_ids select 'merma', m.id
from public.register_product_movement('00000000-0000-4000-8000-0000000015e2', (select id from t_ids where k = 'p'),
  'shrinkage', 3, 'Paquetes rotos') m;
select public.register_product_movement('00000000-0000-4000-8000-0000000015e3', (select id from t_ids where k = 'p'),
  'internal_use', 2, 'Degustación');
-- Una salida común no es merma.
select public.register_product_movement('00000000-0000-4000-8000-0000000015e4', (select id from t_ids where k = 'p'),
  'exit', 4);

insert into t_s select 2, shrinkage_quantity_month, shrinkage_value_month from public.v_inventory_summary;

select public.reverse_stock_movement('00000000-0000-4000-8000-0000000015e5', (select id from t_ids where k = 'merma'),
  'Se cargó dos veces');

insert into t_s select 3, shrinkage_quantity_month, shrinkage_value_month from public.v_inventory_summary;
reset role;

select results_eq(
  $$select (b.qty - a.qty)::numeric, (b.value - a.value)::numeric from t_s a, t_s b where a.step = 1 and b.step = 2$$,
  $$values (5::numeric, 1250::numeric)$$,
  'merma 3 + consumo interno 2 = 5 u. y $1.250 a costo; la salida común no cuenta'
);
select results_eq(
  $$select (b.qty - a.qty)::numeric, (b.value - a.value)::numeric from t_s a, t_s b where a.step = 1 and b.step = 3$$,
  $$values (2::numeric, 500::numeric)$$,
  'al anular la merma, el dashboard deja de contarla (P-21)'
);

-- El empleado sigue sin recibir filas del dashboard.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000015a2", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.v_inventory_summary), 0, 'el empleado no recibe filas del dashboard');
reset role;

-- ---------------------------------------------------------------------------
-- P-22: borrar una configuración de alertas queda auditado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000015a1", "role": "authenticated"}', true);
set local role authenticated;
with created as (
  insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
  values ('00000000-0000-4000-8000-0000000015c1', 3, 7, 15)
  returning id
)
insert into t_ids select 'cfg', id from created;
update public.expiry_alert_settings set urgent_days = 4 where id = (select id from t_ids where k = 'cfg');
delete from public.expiry_alert_settings where id = (select id from t_ids where k = 'cfg');
reset role;

select is(
  (select array_agg(action order by id) from public.audit_log
    where table_name = 'expiry_alert_settings' and record_id = (select id from t_ids where k = 'cfg')),
  array['insert', 'update', 'delete'],
  'la configuración queda auditada al crearla, editarla y borrarla'
);
select is(
  (select (old_data ->> 'urgent_days')::int || ':' || (new_data is null)::text || ':' || changed_by::text
     from public.audit_log
    where table_name = 'expiry_alert_settings' and record_id = (select id from t_ids where k = 'cfg')
      and action = 'delete'),
  '4:true:00000000-0000-4000-8000-0000000015a1',
  'el borrado guarda los datos anteriores y quién lo hizo'
);

-- Las demás tablas siguen auditando como antes.
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000015b2', 'Marca P22');
select is(
  (select action from public.audit_log where table_name = 'brands' and record_id = '00000000-0000-4000-8000-0000000015b2'),
  'insert', 'el alta de una marca se sigue auditando como insert'
);
select throws_ok(
  $$insert into public.audit_log (table_name, record_id, action) values ('x', gen_random_uuid(), 'truncate')$$,
  '23514', null, 'audit_log sigue rechazando acciones desconocidas'
);

select * from finish();
rollback;

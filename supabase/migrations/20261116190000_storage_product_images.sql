-- v0.4 paso I: bucket privado de imágenes de productos.
-- Contrato: docs/DATA_CONTRACT.md v0.4.2, secciones 5.5 (image_path) y 9.
--
-- Bucket "product-images": privado (sin URL pública). Leen los usuarios
-- activos; escriben encargado y dueño, que son quienes editan productos.
-- products.image_path guarda la ruta dentro de este bucket, nunca una URL.
--
-- Migración aditiva: crea el bucket si no existe y sus políticas. No toca
-- archivos ni datos existentes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880, -- 5 MB por imagen
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Sin políticas, storage.objects (que ya tiene RLS) no deja ver ni escribir
-- nada a anon ni authenticated. Estas políticas abren solo este bucket.
create policy product_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select private.is_active_user()));

create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_manager_or_admin()));

create policy product_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_manager_or_admin()))
  with check (bucket_id = 'product-images' and (select private.is_manager_or_admin()));

create policy product_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_manager_or_admin()));

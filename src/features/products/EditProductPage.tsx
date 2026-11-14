import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { fetchEditableProduct } from './api'
import { ProductForm } from './ProductForm'
import { productToFormValues } from './product-form-schema'

/** Edición de un producto (solo encargado y dueño; la base vuelve a controlar). */
export function EditProductPage() {
  const { id = '' } = useParams()
  const client = useSupabase()
  const navigate = useNavigate()
  const toast = useToast()
  const query = useQuery({ queryKey: ['products', 'editable', id], queryFn: () => fetchEditableProduct(client, id) })

  if (query.isPending) return <LoadingState label="Cargando producto…" />
  if (query.error) {
    return (
      <ErrorState
        message={toAppError(query.error).message}
        onRetry={() => void query.refetch()}
        action={<Link to="/productos">Volver a Productos</Link>}
      />
    )
  }

  const p = query.data
  return (
    <>
      <PageHeader title={`Editar: ${p.name}`} description="El stock no se edita acá: se mueve desde Movimientos." />
      <ProductForm
        editing={{ id: p.id, sku: p.sku, values: productToFormValues(p) }}
        onSaved={(saved) => {
          toast.success(`Se guardaron los cambios de "${saved.name}".`)
          navigate(`/productos/${p.id}`)
        }}
        onCancel={() => navigate(`/productos/${p.id}`)}
      />
    </>
  )
}

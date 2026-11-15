import { useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { useToast } from '../../components/ui/toast-context'
import { isBarcodeLike, normalizeBarcode } from '../../domain/barcode'
import { ProductForm } from './ProductForm'

export function NewProductPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  // Llega con ?codigo= cuando se escaneó un código que no existe (BarcodeScanListener).
  const scanned = params.get('codigo') ?? ''
  const initialBarcode = isBarcodeLike(scanned) ? normalizeBarcode(scanned) : undefined

  return (
    <>
      <PageHeader title="Nuevo producto" description="Los campos con * son obligatorios." />
      <ProductForm
        initialBarcode={initialBarcode}
        onCreated={(product) => {
          toast.success(`Se creó "${product.name}" (SKU ${product.sku}).`)
          navigate('/productos')
        }}
        onCancel={() => navigate('/productos')}
      />
    </>
  )
}

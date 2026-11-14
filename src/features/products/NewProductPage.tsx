import { useNavigate } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { useToast } from '../../components/ui/toast-context'
import { ProductForm } from './ProductForm'

export function NewProductPage() {
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <>
      <PageHeader title="Nuevo producto" description="Los campos con * son obligatorios." />
      <ProductForm
        onCreated={(product) => {
          toast.success(`Se creó "${product.name}" (SKU ${product.sku}).`)
          navigate('/productos')
        }}
        onCancel={() => navigate('/productos')}
      />
    </>
  )
}

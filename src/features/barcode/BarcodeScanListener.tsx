import { useLocation, useNavigate } from 'react-router'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { findProductByBarcode } from '../movements/movements-api'
import { useBarcodeScanner } from './useBarcodeScanner'

/**
 * Escanear desde cualquier pantalla (sin estar escribiendo en un campo) abre la
 * ficha del producto. Si no existe, el encargado va directo al alta con el código
 * cargado; el empleado recibe el aviso.
 */
export function BarcodeScanListener() {
  const client = useSupabase()
  const navigate = useNavigate()
  const toast = useToast()
  const canCreate = usePermissions().manageInventory
  // La caja y la carga de inventario manejan el lector ellas mismas: escanear ahí no saca de la pantalla.
  const ownScanner = /^\/(caja|inventario)(\/|$)/.test(useLocation().pathname)

  useBarcodeScanner((code) => {
    // También los inactivos: la ficha muestra su estado.
    findProductByBarcode(client, code, { includeInactive: true })
      .then((product) => {
        if (product) {
          navigate(`/productos/${product.id}`)
        } else if (canCreate) {
          toast.info(`No hay ningún producto con el código ${code}. Podés cargarlo ahora.`)
          navigate(`/productos/nuevo?codigo=${code}`)
        } else {
          toast.error(`No hay ningún producto con el código ${code}. Avisale al encargado.`)
        }
      })
      .catch((e: unknown) => toast.error(toAppError(e).message))
  }, !ownScanner)

  return null
}

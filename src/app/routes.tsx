import type { RouteObject } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { RequirePermission } from '../features/auth/RequirePermission'
import { HomePage } from './HomePage'
import { AppLayout } from './layout/AppLayout'
import { NotFoundPage, RouteErrorPage } from './pages'
import { lazyPage } from './lazyPage'

// Cada pantalla se descarga recién al abrirla; login, inicio y el marco quedan en el bundle principal.
const AlertsPage = lazyPage(() => import('../features/alerts/AlertsPage'), 'AlertsPage')
const AuditPage = lazyPage(() => import('../features/audit/AuditPage'), 'AuditPage')
const PosPage = lazyPage(() => import('../features/pos/PosPage'), 'PosPage')
const PricesPage = lazyPage(() => import('../features/prices/PricesPage'), 'PricesPage')
const RestockPage = lazyPage(() => import('../features/restock/RestockPage'), 'RestockPage')
const SalesPage = lazyPage(() => import('../features/sales/SalesPage'), 'SalesPage')
const ShiftsPage = lazyPage(() => import('../features/shifts/ShiftsPage'), 'ShiftsPage')
const InventoryCountPage = lazyPage(() => import('../features/inventory/InventoryCountPage'), 'InventoryCountPage')
const ImportProductsPage = lazyPage(() => import('../features/import/ImportProductsPage'), 'ImportProductsPage')
const CatalogsPage = lazyPage(() => import('../features/catalogs/CatalogsPage'), 'CatalogsPage')
const MovementsPage = lazyPage(() => import('../features/movements/MovementsPage'), 'MovementsPage')
const EditProductPage = lazyPage(() => import('../features/products/EditProductPage'), 'EditProductPage')
const NewProductPage = lazyPage(() => import('../features/products/NewProductPage'), 'NewProductPage')
const ProductDetailPage = lazyPage(() => import('../features/products/ProductDetailPage'), 'ProductDetailPage')
const ProductsPage = lazyPage(() => import('../features/products/ProductsPage'), 'ProductsPage')
const LabelsPage = lazyPage(() => import('../features/labels/LabelsPage'), 'LabelsPage')
const SettingsPage = lazyPage(() => import('../features/settings/SettingsPage'), 'SettingsPage')

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'caja', element: <PosPage /> },
          { path: 'ventas', element: <SalesPage /> },
          {
            path: 'turnos',
            element: (
              <RequirePermission permission="viewDashboard">
                <ShiftsPage />
              </RequirePermission>
            ),
          },
          { path: 'productos', element: <ProductsPage /> },
          {
            path: 'productos/nuevo',
            element: (
              <RequirePermission permission="manageInventory">
                <NewProductPage />
              </RequirePermission>
            ),
          },
          {
            path: 'productos/importar',
            element: (
              <RequirePermission permission="manageInventory">
                <ImportProductsPage />
              </RequirePermission>
            ),
          },
          { path: 'productos/:id', element: <ProductDetailPage /> },
          {
            path: 'productos/:id/editar',
            element: (
              <RequirePermission permission="manageInventory">
                <EditProductPage />
              </RequirePermission>
            ),
          },
          { path: 'movimientos', element: <MovementsPage /> },
          { path: 'inventario', element: <InventoryCountPage /> },
          { path: 'alertas', element: <AlertsPage /> },
          { path: 'reposicion', element: <RestockPage /> },
          {
            path: 'precios',
            element: (
              <RequirePermission permission="manageInventory">
                <PricesPage />
              </RequirePermission>
            ),
          },
          { path: 'etiquetas', element: <LabelsPage /> },
          { path: 'catalogos', element: <CatalogsPage /> },
          {
            path: 'configuracion',
            element: (
              <RequirePermission permission="configureAlerts">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'auditoria',
            element: (
              <RequirePermission permission="manageUsers">
                <AuditPage />
              </RequirePermission>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

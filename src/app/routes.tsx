import type { RouteObject } from 'react-router'
import { AlertsPage } from '../features/alerts/AlertsPage'
import { AuditPage } from '../features/audit/AuditPage'
import { PosPage } from '../features/pos/PosPage'
import { SalesPage } from '../features/sales/SalesPage'
import { InventoryCountPage } from '../features/inventory/InventoryCountPage'
import { ImportProductsPage } from '../features/import/ImportProductsPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { RequirePermission } from '../features/auth/RequirePermission'
import { CatalogsPage } from '../features/catalogs/CatalogsPage'
import { MovementsPage } from '../features/movements/MovementsPage'
import { EditProductPage } from '../features/products/EditProductPage'
import { NewProductPage } from '../features/products/NewProductPage'
import { ProductDetailPage } from '../features/products/ProductDetailPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { HomePage } from './HomePage'
import { AppLayout } from './layout/AppLayout'
import { NotFoundPage, RouteErrorPage } from './pages'

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

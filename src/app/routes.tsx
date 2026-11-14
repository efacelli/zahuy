import type { RouteObject } from 'react-router'
import { AlertsPage } from '../features/alerts/AlertsPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { RequirePermission } from '../features/auth/RequirePermission'
import { CatalogsPage } from '../features/catalogs/CatalogsPage'
import { NewProductPage } from '../features/products/NewProductPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { HomePage } from './HomePage'
import { AppLayout } from './layout/AppLayout'
import { MovementsPage, NotFoundPage, RouteErrorPage } from './pages'

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
          { path: 'productos', element: <ProductsPage /> },
          {
            path: 'productos/nuevo',
            element: (
              <RequirePermission permission="manageInventory">
                <NewProductPage />
              </RequirePermission>
            ),
          },
          { path: 'movimientos', element: <MovementsPage /> },
          { path: 'alertas', element: <AlertsPage /> },
          { path: 'catalogos', element: <CatalogsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

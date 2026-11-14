import type { RouteObject } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { CatalogsPage } from '../features/catalogs/CatalogsPage'
import { NewProductPage } from '../features/products/NewProductPage'
import { AppLayout } from './layout/AppLayout'
import {
  AlertsPage,
  DashboardPage,
  MovementsPage,
  NotFoundPage,
  ProductsPage,
  RouteErrorPage,
} from './pages'

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
          { index: true, element: <DashboardPage /> },
          { path: 'productos', element: <ProductsPage /> },
          { path: 'productos/nuevo', element: <NewProductPage /> },
          { path: 'movimientos', element: <MovementsPage /> },
          { path: 'alertas', element: <AlertsPage /> },
          { path: 'catalogos', element: <CatalogsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

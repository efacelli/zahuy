import type { RouteObject } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { AppLayout } from './layout/AppLayout'
import {
  AlertsPage,
  CatalogsPage,
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
          { path: 'movimientos', element: <MovementsPage /> },
          { path: 'alertas', element: <AlertsPage /> },
          { path: 'catalogos', element: <CatalogsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

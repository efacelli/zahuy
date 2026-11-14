import type { RouteObject } from 'react-router'
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
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'productos', element: <ProductsPage /> },
      { path: 'movimientos', element: <MovementsPage /> },
      { path: 'alertas', element: <AlertsPage /> },
      { path: 'catalogos', element: <CatalogsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from '@/app/layout/app-layout'
import { NotFoundPage } from '@/app/ui/not-found-page'
import { WeightPage } from '@/features/weight/components/weight-page'
import { paths } from './paths'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={paths.weight} replace />} />
        <Route path={paths.weight} element={<WeightPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

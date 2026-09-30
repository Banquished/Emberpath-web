import { RequireAuth } from '@/app/auth/require-auth'
import { Route, Routes } from 'react-router'
import { AppLayout } from '@/app/layout/app-layout'
import { HomePage } from '@/app/ui/home-page'
import { NotFoundPage } from '@/app/ui/not-found-page'
import { NutritionPage } from '@/features/nutrition/components/nutrition-page'
import { WeightPage } from '@/features/weight/components/weight-page'
import { paths } from './paths'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path={paths.weight} element={<RequireAuth><WeightPage /></RequireAuth>} />
        <Route path={paths.nutrition} element={<RequireAuth signedOutContent={{
          heading: 'Nutrition calculator and plans',
          description: 'Calculate provisional targets and manage saved plan versions. Plans are not a record of food consumed or a safety clearance.',
          guidance: 'Sign in to calculate targets and save, replace or end your plans.',
        }}><NutritionPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

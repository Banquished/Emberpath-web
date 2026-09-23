export type RollingAverageWindow = 7 | 14 | 30

export interface WeightRollingAverage {
  window_days: RollingAverageWindow
  points: { date: string; mean_weight_kg: number; measurement_count: number }[]
}

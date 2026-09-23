import type { WeightLog } from './weight-log'

export interface WeightSummary {
  measurement_count: number
  mean_weight_kg: number | null
  first: WeightLog | null
  latest: WeightLog | null
  change_kg: number | null
  change_percent: number | null
}

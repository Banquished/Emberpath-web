export interface WeightGoalInput {
  target_weight_kg: number
  start_date: string
  target_date: string | null
  baseline_weight_kg?: number | null
}

export interface WeightGoal extends WeightGoalInput {
  baseline_weight_kg: number | null
  plan: {
    duration_days: number
    total_change_kg: number
    weekly_change_kg: number
    fortnightly_change_kg: number
  } | null
  id: string
  status: 'active' | 'completed' | 'cancelled' | 'replaced'
  created_at: string
  ended_at: string | null
}

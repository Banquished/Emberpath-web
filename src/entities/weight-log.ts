export interface WeightLog {
  id: string
  date: string
  weight_kg: number
}

export type WeightLogInput = Omit<WeightLog, 'id'>

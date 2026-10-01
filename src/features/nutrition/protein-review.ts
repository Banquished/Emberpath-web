import type { ProteinSelection } from '@/entities/nutrition-preview'

export const proteinLimits = {
  weightKg: [20, 400],
  perKg: [0.01, 5],
  dailyGrams: [0.01, 2000],
} as const

export function proteinRatio(weightKg: number, protein: ProteinSelection): number | null {
  const [minWeight, maxWeight] = proteinLimits.weightKg
  if (!Number.isFinite(weightKg) || weightKg < minWeight || weightKg > maxWeight) return null
  if (protein.mode === 'per_kg') {
    const [min, max] = proteinLimits.perKg
    return Number.isFinite(protein.g_per_kg) && protein.g_per_kg >= min && protein.g_per_kg <= max ? protein.g_per_kg : null
  }
  const [min, max] = proteinLimits.dailyGrams
  return Number.isFinite(protein.g_per_day) && protein.g_per_day >= min && protein.g_per_day <= max
    ? protein.g_per_day / weightKg
    : null
}

function scaledDecimal(value: number) {
  const [whole, fraction = ''] = String(value).split('.')
  return { units: BigInt(`${whole}${fraction}`), scale: 10n ** BigInt(fraction.length) }
}

export function proteinReviewWarning(weightKg: number, protein: ProteinSelection): string | null {
  if (proteinRatio(weightKg, protein) === null) return null
  let outside: boolean
  if (protein.mode === 'per_kg') {
    outside = protein.g_per_kg < 1 || protein.g_per_kg > 3
  } else {
    // Compare accepted decimal inputs without division drift or a tolerance that hides outside choices.
    const grams = scaledDecimal(protein.g_per_day)
    const weight = scaledDecimal(weightKg)
    const gramsUnits = grams.units * weight.scale
    const weightUnits = weight.units * grams.scale
    outside = gramsUnits < weightUnits || gramsUnits > 3n * weightUnits
  }
  return outside
    ? 'This protein choice is outside the 1-3 g/kg/day product review band. Review your choice; this is not a medically established safe/unsafe cutoff or a safety guarantee.'
    : null
}

export function stepProteinPerKg(value: string, direction: -1 | 1): string | null {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null
  const current = Number(value)
  const [min, max] = proteinLimits.perKg
  if (!Number.isFinite(current) || current < min || current > max) return null

  const decimal = /[eE]/.test(value) ? String(current) : value.startsWith('.') ? `0${value}` : value
  const [whole, fraction = ''] = decimal.split('.')
  const places = Math.max(fraction.length, 1)
  const scale = 10n ** BigInt(places)
  const units = BigInt(whole!) * scale + BigInt(fraction.padEnd(places, '0'))
  const next = units + BigInt(direction) * (scale / 10n)
  if (next < 0n || Number(next) / Number(scale) < min || Number(next) / Number(scale) > max) return null
  const digits = next.toString().padStart(places + 1, '0')
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '')
}

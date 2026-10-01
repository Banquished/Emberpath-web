import { describe, expect, it } from 'vitest'
import type { ProteinSelection } from '@/entities/nutrition-preview'
import { proteinRatio, proteinReviewWarning, stepProteinPerKg } from './protein-review'

describe('protein product review cue', () => {
  it.each([
    [{ mode: 'per_kg', g_per_kg: 0.99 }, true],
    [{ mode: 'per_kg', g_per_kg: 0.9999999999999999 }, true],
    [{ mode: 'per_kg', g_per_kg: 1 }, false],
    [{ mode: 'per_kg', g_per_kg: 1.0000000000000002 }, false],
    [{ mode: 'per_kg', g_per_kg: 2.9999999999999996 }, false],
    [{ mode: 'per_kg', g_per_kg: 3 }, false],
    [{ mode: 'per_kg', g_per_kg: 3.0000000000000004 }, true],
    [{ mode: 'per_kg', g_per_kg: 3.01 }, true],
    [{ mode: 'daily_grams', g_per_day: 79.2 }, true],
    [{ mode: 'daily_grams', g_per_day: 80 }, false],
    [{ mode: 'daily_grams', g_per_day: 240 }, false],
    [{ mode: 'daily_grams', g_per_day: 240.8 }, true],
  ] satisfies [ProteinSelection, boolean][])('compares %o to valid entered weight with strict warning boundaries', (protein, warns) => {
    const warning = proteinReviewWarning(80, protein)
    expect(warning !== null).toBe(warns)
    if (warning) expect(warning).toContain('not a medically established safe/unsafe cutoff or a safety guarantee')
  })

  it.each([
    [70.1, 70.09999999999998, true],
    [70.1, 70.1, false],
    [70.1, 70.10000000000001, false],
    [70.1, 210.29999999999998, false],
    [70.1, 210.3, false],
    [70.1, 210.30000000000004, true],
    [63.7, 63.699999999999996, true],
    [63.7, 63.7, false],
    [63.7, 63.70000000000001, false],
    [63.7, 191.09999999999997, false],
    [63.7, 191.1, false],
    [63.7, 191.10000000000002, true],
    [82.35, 82.34999999999998, true],
    [82.35, 82.35, false],
    [82.35, 82.35000000000001, false],
    [82.35, 247.04999999999998, false],
    [82.35, 247.05, false],
    [82.35, 247.05000000000004, true],
  ])('compares decimal fixed grams at %s kg and %s g without masking an outside choice', (weight, grams, warns) => {
    expect(proteinReviewWarning(weight, { mode: 'daily_grams', g_per_day: grams }) !== null).toBe(warns)
  })

  it.each([
    [0, { mode: 'per_kg', g_per_kg: 3.1 }],
    [Number.NaN, { mode: 'daily_grams', g_per_day: 250 }],
    [Number.POSITIVE_INFINITY, { mode: 'daily_grams', g_per_day: 250 }],
    [19.99, { mode: 'per_kg', g_per_kg: 1.6 }],
    [400.01, { mode: 'per_kg', g_per_kg: 1.6 }],
    [80, { mode: 'per_kg', g_per_kg: 0 }],
    [80, { mode: 'per_kg', g_per_kg: 0.0099 }],
    [80, { mode: 'per_kg', g_per_kg: 5.01 }],
    [80, { mode: 'per_kg', g_per_kg: Number.NaN }],
    [80, { mode: 'per_kg', g_per_kg: Number.POSITIVE_INFINITY }],
    [80, { mode: 'daily_grams', g_per_day: 0 }],
    [80, { mode: 'daily_grams', g_per_day: 0.0099 }],
    [80, { mode: 'daily_grams', g_per_day: 2000.01 }],
    [80, { mode: 'daily_grams', g_per_day: Number.NaN }],
    [80, { mode: 'daily_grams', g_per_day: Number.POSITIVE_INFINITY }],
  ] satisfies [number, ProteinSelection][])('does not warn or compare technically invalid entries: %s kg, %o', (weight, protein) => {
    expect(proteinRatio(weight, protein)).toBeNull()
    expect(proteinReviewWarning(weight, protein)).toBeNull()
  })

  it.each([
    [20, { mode: 'per_kg', g_per_kg: 0.01 }],
    [400, { mode: 'per_kg', g_per_kg: 5 }],
    [20, { mode: 'daily_grams', g_per_day: 0.01 }],
    [400, { mode: 'daily_grams', g_per_day: 2000 }],
  ] satisfies [number, ProteinSelection][])('retains inclusive technical limits independently of the warning band: %s kg, %o', (weight, protein) => {
    expect(proteinRatio(weight, protein)).not.toBeNull()
    expect(proteinReviewWarning(weight, protein)).not.toBeNull()
  })

  it('does not infer a ratio from empty, invalid or technically out-of-range entries', () => {
    expect(proteinRatio(Number(''), { mode: 'per_kg', g_per_kg: 3.1 })).toBeNull()
    expect(proteinRatio(Number.NaN, { mode: 'daily_grams', g_per_day: 250 })).toBeNull()
    expect(proteinRatio(19, { mode: 'per_kg', g_per_kg: 1.6 })).toBeNull()
    expect(proteinRatio(80, { mode: 'per_kg', g_per_kg: 0 })).toBeNull()
    expect(proteinRatio(80, { mode: 'daily_grams', g_per_day: 2000.01 })).toBeNull()
  })

  it('steps exactly one tenth without snapping manually entered valid precision', () => {
    expect(stepProteinPerKg('1.6', 1)).toBe('1.7')
    expect(stepProteinPerKg('1.6', -1)).toBe('1.5')
    expect(stepProteinPerKg('1.65', 1)).toBe('1.75')
    expect(stepProteinPerKg('1.65', -1)).toBe('1.55')
    expect(stepProteinPerKg('1.234', 1)).toBe('1.334')
    expect(stepProteinPerKg('0.01', -1)).toBeNull()
    expect(stepProteinPerKg('5', 1)).toBeNull()
  })

  it.each(['.5', '5e-1', '5E-1', '.5e0', '0.5'])('steps valid manual representation %s up to 0.6 and down to 0.4', (value) => {
    expect(stepProteinPerKg(value, 1)).toBe('0.6')
    expect(stepProteinPerKg(value, -1)).toBe('0.4')
  })

  it.each([
    ['.01', '0.01'],
    ['1e-2', '0.01'],
    ['1E-02', '0.01'],
    ['50e-2', '0.5'],
    ['1.6e0', '1.6'],
    ['16e-1', '1.6'],
    ['1.65e+0', '1.65'],
    ['165e-2', '1.65'],
    ['.5e1', '5'],
    ['5e0', '5'],
  ])('steps %s exactly like canonical %s, including limits and manual precision', (value, canonical) => {
    expect(stepProteinPerKg(value, 1)).toBe(stepProteinPerKg(canonical, 1))
    expect(stepProteinPerKg(value, -1)).toBe(stepProteinPerKg(canonical, -1))
  })

  it.each([
    '', ' ', ' 0.5', '0.5 ', '.', '1.', '1.e0', '+.5', '0x1',
    '5e', '5e-', 'NaN', 'Infinity', '-Infinity', '1e309', '1e-400',
    '-.5', '0', '.009', '9e-3', '5.01', '501e-2',
  ])('does not step invalid, blank, nonfinite or out-of-bound input %j', (value) => {
    expect(stepProteinPerKg(value, 1)).toBeNull()
    expect(stepProteinPerKg(value, -1)).toBeNull()
  })
})

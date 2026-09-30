// @vitest-environment node
import { expect, it } from 'vitest'
import config from '../../vite.config'

it('routes nutrition estimates to /api/v1 before the generic weight proxy', () => {
  const proxy = config.server?.proxy
  expect(Object.keys(proxy ?? {}).slice(0, 2)).toEqual(['/api/nutrition/v1', '/api'])

  const nutrition = proxy?.['/api/nutrition/v1']
  const weight = proxy?.['/api']
  if (!nutrition || typeof nutrition === 'string' || !weight || typeof weight === 'string') {
    throw new Error('Both API proxies must provide explicit rewrite rules.')
  }
  expect(nutrition.target).toBe(process.env.NUTRITION_SERVICE_URL || 'http://127.0.0.1:8001')
  expect(nutrition.rewrite?.('/api/nutrition/v1/estimates/options')).toBe('/api/v1/estimates/options')
  expect(nutrition.rewrite?.('/api/nutrition/v1/estimates/preview')).toBe('/api/v1/estimates/preview')
  expect(weight.rewrite?.('/api/weight-logs')).toBe('/weight-logs')
})

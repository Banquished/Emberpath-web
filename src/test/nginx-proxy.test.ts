// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const nginx = readFileSync(new URL('../../nginx.conf', import.meta.url), 'utf8')

function locationBlock(matcher: string) {
  const location = nginx.match(new RegExp(`location ${matcher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))
  if (!location) throw new Error(`Missing Nginx location ${matcher}`)
  return location[1]
}

it('routes nutrition to its service at request time without sending the bare prefix to Weight', () => {
  expect(locationBlock('= /api/nutrition/v1')).toMatch(/return 404;/)
  const nutrition = locationBlock('^~ /api/nutrition/v1/')
  expect(nutrition).toContain('resolver 127.0.0.11 valid=30s ipv6=off;')
  expect(nutrition).toContain('set $nutrition_upstream nutrition-service:8000;')
  expect(nutrition).toContain('rewrite ^/api/nutrition/v1/(.*)$ /api/v1/$1 break;')
  expect(nutrition).toContain('proxy_pass http://$nutrition_upstream;')
  expect(nutrition).toContain('proxy_set_header Authorization $http_authorization;')
  expect(nutrition).toContain('proxy_set_header X-Request-ID $http_x_request_id;')
  expect(nutrition).toContain('proxy_pass_header X-Request-ID;')
  expect(nutrition).not.toContain('weight-service')
})

it('keeps Weight uploads and SPA fallback on their existing routes', () => {
  const weight = locationBlock('/api/')
  expect(weight).toContain('client_max_body_size 8m;')
  expect(weight).toContain('proxy_pass http://weight-service:8000/;')
  expect(locationBlock('/')).toContain('try_files $uri $uri/ /index.html;')
})

import { describe, expect, it } from 'vitest'
import { SERVICE_BASE_URLS, serviceEndpoint } from '../electron/types'

describe('MiMo service endpoints', () => {
  it('uses the pay-as-you-go endpoint by default', () => {
    expect(SERVICE_BASE_URLS.payg).toBe('https://api.xiaomimimo.com/v1')
    expect(serviceEndpoint('payg', 'chat/completions')).toBe('https://api.xiaomimimo.com/v1/chat/completions')
  })

  it('builds Token Plan endpoints without duplicate slashes', () => {
    expect(SERVICE_BASE_URLS['token-plan']).toBe('https://token-plan-cn.xiaomimimo.com/v1')
    expect(serviceEndpoint('token-plan', '/models')).toBe('https://token-plan-cn.xiaomimimo.com/v1/models')
  })
})

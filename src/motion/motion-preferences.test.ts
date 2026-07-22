import { describe, expect, it } from 'vitest'
import { motionPreference } from './motion-preferences'

describe('motionPreference', () => {
  it('strictly disables motion when the user turns reduced motion on in the app', () => {
    expect(motionPreference(true)).toEqual({
      motionConfig: 'always',
      shouldAnimate: false,
      scrollBehavior: 'auto',
    })
  })

  it('follows the operating system while retaining smooth interactions by default', () => {
    expect(motionPreference(false)).toEqual({
      motionConfig: 'user',
      shouldAnimate: true,
      scrollBehavior: 'smooth',
    })
  })
})

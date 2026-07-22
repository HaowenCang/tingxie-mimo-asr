import { describe, expect, it } from 'vitest'
import { motionVariants } from './variants'

describe('motionVariants', () => {
  it('makes every reduced-motion variant transition immediate', () => {
    const variants = motionVariants(true)

    for (const variant of Object.values(variants)) {
      for (const state of Object.values(variant)) {
        if (typeof state === 'object' && state && 'transition' in state) {
          expect(state.transition).toMatchObject({ duration: 0 })
        }
      }
    }
  })

  it('keeps authored timing when motion is enabled', () => {
    const variants = motionVariants(false)
    expect(variants.fade.animate).toMatchObject({ transition: { duration: 0.16 } })
    expect(variants.fadeUp.animate).toMatchObject({ transition: { duration: 0.22 } })
  })
})

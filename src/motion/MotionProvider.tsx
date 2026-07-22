import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { createContext, useContext, type ReactNode } from 'react'
import { motionPreference } from './motion-preferences'

const ReducedMotionContext = createContext(false)

export function useReducedMotionSetting() {
  return useContext(ReducedMotionContext)
}

export function MotionProvider({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const preference = motionPreference(reducedMotion)
  return <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion={preference.motionConfig} transition={reducedMotion ? { duration: 0 } : undefined}>
      <ReducedMotionContext.Provider value={reducedMotion}>{children}</ReducedMotionContext.Provider>
    </MotionConfig>
  </LazyMotion>
}

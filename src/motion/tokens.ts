export const motionDuration = {
  instant: 0.1,
  fast: 0.16,
  base: 0.22,
  slow: 0.3,
} as const

export const motionEase = {
  standard: [0.2, 0.8, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
} as const

export const motionSpring = {
  snappy: { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.7 },
  panel: { type: 'spring' as const, stiffness: 360, damping: 36, mass: 0.9 },
} as const

export const motionDistance = { xs: 4, sm: 8, md: 16 } as const

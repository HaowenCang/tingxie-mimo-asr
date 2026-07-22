export interface MotionPreference {
  motionConfig: 'always' | 'user'
  shouldAnimate: boolean
  scrollBehavior: ScrollBehavior
}

export function motionPreference(reducedMotion: boolean): MotionPreference {
  return reducedMotion
    ? { motionConfig: 'always', shouldAnimate: false, scrollBehavior: 'auto' }
    : { motionConfig: 'user', shouldAnimate: true, scrollBehavior: 'smooth' }
}

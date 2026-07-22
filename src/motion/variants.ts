import type { Variants } from 'motion/react'
import { motionDistance, motionDuration, motionEase, motionSpring } from './tokens'
import { useReducedMotionSetting } from './MotionProvider'

const immediate = { duration: 0 } as const

export function motionVariants(reducedMotion: boolean) {
  const transition = <T,>(authored: T) => reducedMotion ? immediate : authored

  const fade: Variants = {
    initial: { opacity: 0, transition: immediate },
    animate: { opacity: 1, transition: transition({ duration: motionDuration.fast }) },
    exit: { opacity: 0, transition: transition({ duration: motionDuration.instant }) },
  }

  const fadeUp: Variants = {
    initial: { opacity: 0, y: reducedMotion ? 0 : motionDistance.sm, transition: immediate },
    animate: { opacity: 1, y: 0, transition: transition({ duration: motionDuration.base, ease: motionEase.standard }) },
    exit: { opacity: 0, y: reducedMotion ? 0 : -motionDistance.xs, transition: transition({ duration: motionDuration.fast, ease: motionEase.exit }) },
  }

  const panelFromRight: Variants = {
    initial: { opacity: 0, x: reducedMotion ? 0 : motionDistance.md, transition: immediate },
    animate: { opacity: 1, x: 0, transition: transition(motionSpring.panel) },
    exit: { opacity: 0, x: reducedMotion ? 0 : motionDistance.sm, transition: transition({ duration: motionDuration.fast, ease: motionEase.exit }) },
  }

  const dialogPanel: Variants = {
    initial: { opacity: 0, y: reducedMotion ? 0 : motionDistance.sm, scale: reducedMotion ? 1 : 0.985, transition: immediate },
    animate: { opacity: 1, y: 0, scale: 1, transition: transition({ duration: motionDuration.base, ease: motionEase.standard }) },
    exit: { opacity: 0, y: reducedMotion ? 0 : motionDistance.xs, scale: reducedMotion ? 1 : 0.99, transition: transition({ duration: motionDuration.fast, ease: motionEase.exit }) },
  }

  const listItem: Variants = {
    initial: { opacity: 0, y: reducedMotion ? 0 : -6, scale: reducedMotion ? 1 : 0.99, transition: immediate },
    animate: { opacity: 1, y: 0, scale: 1, transition: transition(motionSpring.snappy) },
    exit: { opacity: 0, scale: reducedMotion ? 1 : 0.985, transition: transition({ duration: motionDuration.fast, ease: motionEase.exit }) },
  }

  const iconSwap: Variants = {
    initial: { opacity: 0, scale: reducedMotion ? 1 : 0.72, transition: immediate },
    animate: { opacity: 1, scale: 1, transition: transition(motionSpring.snappy) },
    exit: { opacity: 0, scale: reducedMotion ? 1 : 0.78, transition: transition({ duration: motionDuration.instant }) },
  }

  return { fade, fadeUp, panelFromRight, dialogPanel, listItem, iconSwap }
}

export function useMotionVariants() {
  return motionVariants(useReducedMotionSetting())
}

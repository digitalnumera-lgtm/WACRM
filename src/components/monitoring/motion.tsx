'use client'

import type { ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react'

// Motion rules for the CRM (see the crm-motion skill): animate only in answer
// to what someone did, keep it short (150–250 ms, ease-out), move only
// transform/opacity, and follow the device's reduced-motion setting.
export const easeOut = [0.23, 1, 0.32, 1] as const
export const spring = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const
export const pop = { type: 'spring', stiffness: 600, damping: 20 } as const

/** Loads the small animation feature set once and respects reduced motion. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: easeOut }}>{children}</MotionConfig>
  </LazyMotion>
}

/** Background that slides to the selected tab or option. The parent needs `relative isolate`. */
export function ActivePill({ id, className }: { id: string; className: string }) {
  return <m.span layoutId={id} aria-hidden="true" className={`absolute inset-0 -z-10 ${className}`} transition={spring} />
}

'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, animate, domAnimation, m, useReducedMotion } from 'motion/react'

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

/**
 * A number that counts up to its value (and glides to new values when the
 * stats refresh). Writes the text directly so it never re-renders React, and
 * jumps straight to the value when the device asks for reduced motion.
 */
export function CountUp({ value, className }: { value: number | undefined | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el || value == null) return
    const from = shown.current
    if (reduce || from === value) { shown.current = value; el.textContent = value.toLocaleString(); return }
    const controls = animate(from, value, {
      duration: Math.min(1.1, 0.5 + Math.log10(Math.abs(value - from) + 1) * 0.2),
      ease: easeOut,
      onUpdate: v => { shown.current = Math.round(v); el.textContent = Math.round(v).toLocaleString() },
    })
    return () => controls.stop()
  }, [value, reduce])
  return <span ref={ref} className={`tabular-nums ${className ?? ''}`}>{value == null ? '—' : '0'}</span>
}

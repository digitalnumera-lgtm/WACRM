'use client'

import { useCallback, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'

const HOLD_MS = 280
const MOVE_CANCEL_PX = 8

type Drag = { name: string; pointer: number; start: number; offset: number; vertical: boolean }

/**
 * Sidebar items that can be rearranged: press and hold an icon until it lifts,
 * then move it up or down (left or right in the phone bar) and let go. A quick
 * tap still opens the page. Keyboard: focus an icon and use Alt + arrow keys.
 */
export function SortableNav({ order, onReorder, render }: {
  order: string[]
  onReorder: (order: string[]) => void
  render: (name: string, state: { dragging: boolean; onPointerDown: (e: ReactPointerEvent) => void; onKeyDown: (e: React.KeyboardEvent) => void; style?: React.CSSProperties; suppressClick: () => boolean }) => ReactNode
}) {
  const [live, setLive] = useState<string[] | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const justDragged = useRef(false)
  const list = live ?? order
  const suppressClick = useCallback(() => justDragged.current, [])

  const begin = (name: string, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const parent = el.parentElement
    const vertical = parent ? getComputedStyle(parent).flexDirection.startsWith('column') : true
    const startPos = vertical ? e.clientY : e.clientX
    const startOther = vertical ? e.clientX : e.clientY
    let current = [...order]
    let dragState: Drag | null = null
    const timer = window.setTimeout(() => {
      dragState = { name, pointer: startPos, start: startPos, offset: 0, vertical }
      setLive(current); setDrag(dragState)
      try { el.setPointerCapture(e.pointerId) } catch { /* Element gone. */ }
      navigator.vibrate?.(10)
    }, HOLD_MS)
    const move = (ev: PointerEvent) => {
      const pos = vertical ? ev.clientY : ev.clientX
      if (!dragState) {
        // Moving before the hold finishes means scrolling or a normal click.
        if (Math.abs(pos - startPos) > MOVE_CANCEL_PX || Math.abs((vertical ? ev.clientX : ev.clientY) - startOther) > MOVE_CANCEL_PX) end()
        return
      }
      ev.preventDefault()
      let offset = pos - dragState.start
      const index = current.indexOf(name)
      const neighbour = (step: number) => {
        const other = current[index + step]
        const node = other ? parent?.querySelector<HTMLElement>(`[data-nav="${other}"]`) : null
        return node ? { other, size: (vertical ? node.offsetHeight : node.offsetWidth) + 4 } : null
      }
      const next = neighbour(1), prev = neighbour(-1)
      if (next && offset > next.size / 2) {
        current = [...current]; current.splice(index, 1); current.splice(index + 1, 0, name)
        dragState.start += next.size; offset -= next.size
      } else if (prev && offset < -prev.size / 2) {
        current = [...current]; current.splice(index, 1); current.splice(index - 1, 0, name)
        dragState.start -= prev.size; offset += prev.size
      }
      dragState = { ...dragState, pointer: pos, offset }
      setLive(current); setDrag(dragState)
    }
    const end = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (dragState) {
        justDragged.current = true
        window.setTimeout(() => { justDragged.current = false }, 50)
        if (current.join() !== order.join()) onReorder(current)
      }
      setLive(null); setDrag(null)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const keyMove = (name: string, e: React.KeyboardEvent) => {
    if (!e.altKey) return
    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    e.preventDefault()
    const index = order.indexOf(name), target = index + step
    if (target < 0 || target >= order.length) return
    const next = [...order]; next.splice(index, 1); next.splice(target, 0, name)
    onReorder(next)
  }

  // The handlers below read refs only when an event fires, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  return <>{list.map(name => {
    const dragging = drag?.name === name
    return render(name, {
      dragging,
      onPointerDown: e => begin(name, e),
      onKeyDown: e => keyMove(name, e),
      suppressClick,
      style: dragging ? { transform: `${drag.vertical ? 'translateY' : 'translateX'}(${drag.offset}px) scale(1.12)`, zIndex: 20, transition: 'none', touchAction: 'none' } : undefined,
    })
  })}</>
}

/** Applies a saved order to the pages this person can see; new pages keep their default place at the end. */
export function orderedPages<T extends string>(pages: T[], saved: string[]): T[] {
  const known = saved.filter((n): n is T => pages.includes(n as T))
  return [...known, ...pages.filter(p => !known.includes(p))]
}

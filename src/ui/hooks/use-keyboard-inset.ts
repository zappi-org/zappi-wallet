import { useEffect, useState } from 'react'

/**
 * Height (px) the soft keyboard covers at the bottom of the layout viewport.
 * WHY: this is a PWA with no native wrapper, so VisualViewport is the only way
 * to observe the keyboard — the layout viewport does not shrink on iOS Safari.
 */
export function computeInset(innerHeight: number, vv: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(computeInset(window.innerHeight, { height: vv.height, offsetTop: vv.offsetTop }))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

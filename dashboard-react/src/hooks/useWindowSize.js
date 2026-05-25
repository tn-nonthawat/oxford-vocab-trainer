import { useState, useEffect } from 'react'

/**
 * Returns the current window width and height, updating on resize.
 * Used by Dashboard to pick the right grid breakpoint (lg / md / sm).
 */
export function useWindowSize() {
  const [size, setSize] = useState({
    width:  typeof window !== 'undefined' ? window.innerWidth  : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  })

  useEffect(() => {
    let raf = null

    function onResize() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setSize({ width: window.innerWidth, height: window.innerHeight })
      })
    }

    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return size
}

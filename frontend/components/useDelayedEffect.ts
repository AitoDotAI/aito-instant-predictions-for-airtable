import { useEffect, useRef } from 'react'

const useDelayedEffect = (delay: number, onAfterDelay: (hasUnmounted: () => boolean) => unknown): void => {
  const delayedRequest = useRef<ReturnType<typeof setTimeout> | undefined | null>(undefined)

  useEffect(() => {
    if (delayedRequest.current !== undefined) {
      return
    }

    const hasUnmounted = () => delayedRequest.current === null

    delayedRequest.current = setTimeout(async () => {
      if (hasUnmounted()) {
        return
      }
      onAfterDelay(hasUnmounted)
    }, delay)

    return () => {
      if (delayedRequest.current) {
        clearTimeout(delayedRequest.current)
        delayedRequest.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

export default useDelayedEffect

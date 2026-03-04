import { useSearchParams } from "react-router-dom"
import { useCallback, useRef } from "react"

/**
 * Microtask batching: when multiple useUrlState setters fire in the same
 * synchronous tick (e.g. setChannel("ozon"); setPage(0)), we collect all
 * changes and flush them as a single setSearchParams call. Without this,
 * the second call would overwrite the first (React Router navigations
 * don't queue like React state updates).
 */
let pending: Map<string, string | null> | null = null
let flushSetSearchParams: ((fn: (prev: URLSearchParams) => URLSearchParams, opts?: { replace: boolean }) => void) | null = null

/**
 * Like useState but persists value in URL search params.
 * Empty/default values are removed from URL to keep it clean.
 */
export function useUrlState(key: string, defaultValue = ""): [string, (v: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(key) ?? defaultValue

  // Keep a ref so the microtask always uses the latest setSearchParams
  const ref = useRef(setSearchParams)
  ref.current = setSearchParams

  const setValue = useCallback(
    (v: string) => {
      // Schedule flush on first call in this tick
      if (!pending) {
        pending = new Map()
        flushSetSearchParams = ref.current
        queueMicrotask(() => {
          const updates = pending!
          const setter = flushSetSearchParams!
          pending = null
          flushSetSearchParams = null
          setter(
            (prev) => {
              const next = new URLSearchParams(prev)
              for (const [k, val] of updates) {
                if (val === null) next.delete(k)
                else next.set(k, val)
              }
              return next
            },
            { replace: true },
          )
        })
      }

      if (v === defaultValue || v === "") {
        pending!.set(key, null)
      } else {
        pending!.set(key, v)
      }
    },
    [key, defaultValue],
  )

  return [value, setValue]
}

/**
 * useUrlState for numeric values (e.g. page number).
 */
export function useUrlNumber(key: string, defaultValue = 0): [number, (v: number) => void] {
  const [raw, setRaw] = useUrlState(key, String(defaultValue))
  const value = Number(raw) || defaultValue
  const setValue = useCallback((v: number) => setRaw(String(v)), [setRaw])
  return [value, setValue]
}

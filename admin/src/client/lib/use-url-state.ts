import { useSearchParams } from "react-router-dom"
import { useCallback } from "react"

/**
 * Like useState but persists value in URL search params.
 * Empty/default values are removed from URL to keep it clean.
 */
export function useUrlState(key: string, defaultValue = ""): [string, (v: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback(
    (v: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v === defaultValue || v === "") {
            next.delete(key)
          } else {
            next.set(key, v)
          }
          return next
        },
        { replace: true },
      )
    },
    [key, defaultValue, setSearchParams],
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

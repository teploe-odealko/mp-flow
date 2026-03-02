import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ColumnDocWithPlugins } from "../../shared/column-docs"

interface ColumnDocPopoverProps {
  doc: ColumnDocWithPlugins
  onClose: () => void
  getAnchorRect: () => DOMRect | null
}

export function ColumnDocPopover({ doc, onClose, getAnchorRect }: ColumnDocPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", opacity: 0 })

  // Position the popover relative to the anchor button
  useEffect(() => {
    const rect = getAnchorRect()
    if (!rect) return

    const popoverWidth = 320
    let left = rect.left
    const top = rect.bottom + 6

    // Prevent overflow on the right
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16
    }
    // Prevent overflow on the left
    if (left < 16) left = 16

    setStyle({ position: "fixed", top, left, width: popoverWidth, opacity: 1, zIndex: 9999 })
  }, [getAnchorRect])

  useEffect(() => {
    const mountTime = Date.now()
    function handleClick(e: MouseEvent) {
      // Ignore clicks within 100ms of mount to avoid the opening click
      if (Date.now() - mountTime < 100) return
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="bg-bg-surface border border-bg-border rounded-lg shadow-lg p-4 text-left"
    >
      <p className="text-sm font-semibold text-text-primary mb-2">{doc.label}</p>
      <p className="text-sm text-text-secondary">{doc.description}</p>

      {doc.pluginContributions && doc.pluginContributions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-bg-border space-y-2">
          {doc.pluginContributions.map((pc, i) => (
            <div key={i}>
              <span className="inline-block px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] font-semibold uppercase rounded mb-1">
                {pc.pluginLabel}
              </span>
              <p className="text-xs text-text-secondary">{pc.description}</p>
              {pc.links && pc.links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {pc.links.map((link, j) => (
                    <a
                      key={j}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      {link.label} &rarr;
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

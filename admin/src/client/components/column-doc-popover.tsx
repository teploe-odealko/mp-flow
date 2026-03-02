import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ColumnDocWithPlugins } from "../../shared/column-docs"

interface ColumnDocPopoverProps {
  doc: ColumnDocWithPlugins
  onClose: () => void
  getAnchorRect: () => DOMRect | null
}

/** Render text with markdown-style [label](url) links as clickable <a> elements */
function RichText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline"
      >
        {match[1]}
      </a>,
    )
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return <p className={className}>{parts}</p>
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
      <RichText text={doc.description} className="text-sm text-text-secondary" />

      {doc.pluginContributions && doc.pluginContributions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-bg-border space-y-2">
          {doc.pluginContributions.map((pc, i) => (
            <div key={i}>
              <span className="inline-block px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] font-semibold uppercase rounded mb-1">
                {pc.pluginLabel}
              </span>
              <RichText text={pc.description} className="text-xs text-text-secondary" />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

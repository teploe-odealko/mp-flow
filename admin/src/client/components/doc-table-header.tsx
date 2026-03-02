import { useState, useRef, useCallback } from "react"
import { useColumnDoc } from "./column-docs-provider"
import { ColumnDocPopover } from "./column-doc-popover"

interface DocTableHeaderProps {
  pageId: string
  columnKey: string
  children: React.ReactNode
  className?: string
}

export function DocTableHeader({ pageId, columnKey, children, className }: DocTableHeaderProps) {
  const doc = useColumnDoc(pageId, columnKey)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const getAnchorRect = useCallback(() => {
    return btnRef.current?.getBoundingClientRect() ?? null
  }, [])

  if (!doc) {
    return <th className={className}>{children}</th>
  }

  return (
    <th className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          className="text-text-muted hover:text-accent transition-colors text-[10px] leading-none select-none"
          title="Документация"
        >
          &#9432;
        </button>
      </span>
      {open && <ColumnDocPopover doc={doc} onClose={() => setOpen(false)} getAnchorRect={getAnchorRect} />}
    </th>
  )
}

import { createContext, useContext } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../lib/api"
import type { PageColumnDocsWithPlugins, ColumnDocWithPlugins } from "../../shared/column-docs"

const ColumnDocsContext = createContext<PageColumnDocsWithPlugins[] | null>(null)

export function ColumnDocsProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["column-docs"],
    queryFn: () => apiGet<{ pages: PageColumnDocsWithPlugins[] }>("/api/column-docs"),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <ColumnDocsContext.Provider value={data?.pages ?? null}>
      {children}
    </ColumnDocsContext.Provider>
  )
}

export function useColumnDoc(pageId: string, columnKey: string): ColumnDocWithPlugins | null {
  const pages = useContext(ColumnDocsContext)
  if (!pages) return null
  const page = pages.find((p) => p.pageId === pageId)
  return page?.columns.find((c) => c.key === columnKey) ?? null
}

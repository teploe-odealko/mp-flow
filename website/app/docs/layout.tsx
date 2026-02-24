import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: "OpenMPFlow",
      }}
      links={[
        {
          text: "API Playground",
          url: "https://proxy.mp-flow.ru/docs",
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}

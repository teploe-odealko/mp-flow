import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { GitHubStars } from "@/components/github-stars";

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo.png" alt="MPFlow" width={24} height={24} className="rounded-md" />
      <span className="font-semibold">MPFlow</span>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      githubUrl="https://github.com/teploe-odealko/mp-flow"
      nav={{
        title: <Logo />,
        children: <GitHubStars />,
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

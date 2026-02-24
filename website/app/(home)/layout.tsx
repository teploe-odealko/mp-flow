import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: "OpenMPFlow",
      }}
      links={[
        { text: "Docs", url: "/docs" },
        {
          text: "API Playground",
          url: "https://proxy.mp-flow.ru/docs",
          external: true,
        },
        {
          text: "GitHub",
          url: "https://github.com/teploe-odealko/openmpflow",
          external: true,
        },
      ]}
    >
      {children}
    </HomeLayout>
  );
}

import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: "OpenMPFlow",
      }}
      links={[
        { text: "Документация", url: "/docs" },
        {
          text: "API",
          url: "https://proxy.mp-flow.ru/docs",
          external: true,
        },
        {
          text: "GitHub",
          url: "https://github.com/nickthecook/mpflow",
          external: true,
        },
      ]}
    >
      {children}
    </HomeLayout>
  );
}

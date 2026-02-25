import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.png" alt="MPFlow" width={28} height={28} className="rounded-md" />
      <span className="font-semibold text-lg">MPFlow</span>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: <Logo />,
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
          url: "https://github.com/teploe-odealko/mp-flow",
          external: true,
        },
      ]}
    >
      {children}
    </HomeLayout>
  );
}

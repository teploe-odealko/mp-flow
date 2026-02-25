import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        fill="none"
        className="h-6 w-6"
      >
        <defs>
          <linearGradient
            id="doc-logo-grad"
            x1="0"
            y1="0"
            x2="32"
            y2="32"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="7" fill="url(#doc-logo-grad)" />
        <path
          d="M7 11 C11 11, 13 16, 18 16 C23 16, 25 11, 29 11"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.45"
        />
        <path
          d="M5 16 C10 16, 13 22, 18 22 C23 22, 26 16, 31 16"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M7 21 C11 21, 13 26, 18 26 C23 26, 25 21, 29 21"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.45"
        />
      </svg>
      <span className="font-semibold">OpenMPFlow</span>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: <Logo />,
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

import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        fill="none"
        className="h-7 w-7"
      >
        <defs>
          <linearGradient
            id="logo-grad"
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
        <rect width="32" height="32" rx="7" fill="url(#logo-grad)" />
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
      <span className="font-semibold text-lg">OpenMPFlow</span>
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

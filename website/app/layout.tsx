import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    template: "%s | OpenMPFlow Docs",
    default: "OpenMPFlow Docs",
  },
  description:
    "Documentation for OpenMPFlow — open-source ERP for Ozon FBO sellers",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

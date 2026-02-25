import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    template: "%s | OpenMPFlow",
    default: "OpenMPFlow — документация",
  },
  description:
    "Документация OpenMPFlow — open source ERP для продавцов на Ozon. FIFO учёт, юнит-экономика, ценообразование, AI-агент.",
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

import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    template: "%s | MPFlow",
    default: "MPFlow — документация",
  },
  description:
    "Документация MPFlow — open source ERP для продавцов на Ozon. FIFO учёт, юнит-экономика, ценообразование, AI-агент.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
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

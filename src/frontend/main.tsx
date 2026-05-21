import React from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    __MPFLOW_CONFIG__?: {
      sentryDsn?: string;
      sentryEnvironment?: string;
      sentryRelease?: string;
    };
  }
}

const sentryDsn = window.__MPFLOW_CONFIG__?.sentryDsn || import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: window.__MPFLOW_CONFIG__?.sentryEnvironment ?? import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: window.__MPFLOW_CONFIG__?.sentryRelease ?? import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0)
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: false
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

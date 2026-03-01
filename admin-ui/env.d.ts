/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Dynamic CDN import for Logto browser SDK
declare module 'https://cdn.jsdelivr.net/npm/@logto/browser@3/+esm' {
  const LogtoClient: any
  export default LogtoClient
}

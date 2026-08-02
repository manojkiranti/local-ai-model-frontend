/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Local LLM Gateway (default "http://localhost:8000"). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

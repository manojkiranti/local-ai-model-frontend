/**
 * Runtime API configuration.
 *
 * The base URL for the Ollama-gateway backend comes from `VITE_API_BASE_URL`
 * and is never hardcoded in components. It defaults to `http://localhost:8000`
 * (the gateway's default), which means the browser talks to the gateway
 * directly — so the gateway needs CORS enabled for the agent endpoints.
 *
 * Escape hatch: set `VITE_API_BASE_URL=` (empty) to use same-origin paths
 * instead, which Vite's dev proxy already forwards to the gateway (the same way
 * the existing chat/embeddings calls avoid CORS). See vite.config.ts.
 */
const configured = import.meta.env.VITE_API_BASE_URL

export const API_BASE: string =
  configured === undefined ? 'http://localhost:8000' : configured.replace(/\/$/, '')

/** Join the configured base with an API path (e.g. `apiUrl('/v1/agent')`). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

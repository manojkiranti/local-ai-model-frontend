# Ollama Gateway AI Workspace — Design

**Date:** 2026-07-29
**Status:** Approved

## Purpose

A browser workspace for the local **Ollama Gateway** FastAPI backend
(`/home/manoj/newlaptop/projects/python/local-ai-model`). It gives a clean UI
over the gateway's four endpoints so a developer can chat with local models,
run several conversations in a session, and inspect embeddings.

## Backend API (fixed contract)

| Method | Path             | Notes |
| ------ | ---------------- | ----- |
| GET    | `/health`        | `{status, ollama:{base_url, reachable}, default_chat_model, default_embed_model}`; 200 ok / 503 degraded |
| GET    | `/v1/models`     | `{models: [{name, model?, size?, modified_at?}]}` |
| POST   | `/v1/chat`       | `{messages:[{role,content}], model?, stream?, options?}` → JSON, or NDJSON stream when `stream:true` (one Ollama chat chunk per line, final has `done:true`) |
| POST   | `/v1/embeddings` | `{input: string \| string[], model?}` → `{model, embeddings: number[][]}` |

The frontend must not require backend changes. CORS is avoided by using Vite's
dev proxy to forward `/v1` and `/health` to `http://localhost:8000`.

## Scope (agreed)

- **Streaming chat** — centerpiece. Model picker, generation options
  (temperature, num_ctx, system prompt), live token streaming, stop button.
- **Multiple conversations** — sidebar of session threads, in-memory only
  (reset on reload). Create / switch / rename / delete.
- **Embeddings playground** — 1–2 text inputs, show vector dimension + value
  preview, and cosine similarity when two inputs are given.
- **Header status** — health dot (polls `/health`) + active-model indicator.
  Not a full model-manager tab.

Out of scope: persistence, auth, multi-user, backend changes.

## Design direction

Clean & functional, built on Tailwind v4 + shadcn-style primitives.
Dark-first with a light toggle. Zinc/slate neutrals with a calm teal accent.
Monospace (`ui-monospace`/JetBrains Mono) for machine data — model tags, token
counts, latency, vector values — Inter for UI/body. This gives a deliberate
"technical console" identity without heavy custom styling.

## Architecture

App shell: left **Sidebar** (conversations), top **Header** (Chat/Embeddings
tabs, model picker, health dot, theme toggle), main **panel** switching between
Chat and Embeddings.

### Modules (isolated, single-purpose)

- `lib/utils.ts` — `cn()` class merge helper.
- `lib/api.ts` — typed client for the 4 endpoints; `streamChat()` parses the
  NDJSON stream via `fetch` + `ReadableStream`, yielding assistant deltas;
  `cosineSimilarity()` helper. Types mirror the backend schemas.
- `hooks/useModels.ts` — fetch `/v1/models` once; expose list + refresh.
- `hooks/useHealth.ts` — poll `/health` (~15s); expose reachable + defaults.
- `hooks/useConversations.ts` — in-memory conversation store (list, active id,
  create/rename/delete, append/patch messages).
- `hooks/useTheme.ts` — light/dark toggle via `.dark` on `<html>`.
- `components/ui/*` — shadcn-style primitives (button, input, textarea, badge,
  card, tabs, popover, select, slider, tooltip, label, separator,
  dropdown-menu, scroll helpers).
- `components/layout/*` — `Sidebar`, `Header`, `StatusDot`.
- `components/chat/*` — `ChatPanel`, `MessageList`, `MessageBubble`
  (markdown + code), `Composer`, `GenerationSettings`.
- `components/embeddings/EmbeddingsPanel`.
- `App.tsx` — wires shell, tabs, theme.

### Data flow (chat)

Composer submit → `useConversations.appendUser` → `api.streamChat({messages,
model, options}, signal)` async-iterates deltas → append/patch the streaming
assistant bubble → mark `done` and stamp token counts. **Stop** aborts via
`AbortController`. Gateway error JSON (404/502/504) surfaces as an inline error
bubble with retry.

### States

- Ollama unreachable → red health dot + banner; composer/embeddings disabled.
- `/v1/models` empty → picker shows "No models — pull one first".
- Streaming → assistant bubble shows a caret; send becomes Stop.

## Testing

Vitest units for the two pieces of real logic:
1. NDJSON stream parser (`streamChat` line assembly, split chunks, `done`).
2. `cosineSimilarity` (known vectors, orthogonal, identical).

No heavy component tests for a session-only tool.

## Evaluation & Improvement

1. **Success metric** — a developer can send a chat prompt and see a streamed
   reply, switch models, and get an embedding + similarity, all without console
   errors, against a live gateway. Proxy for "working": the two Vitest units
   pass and `npm run build` is clean.
2. **Eval** — the Vitest suite (stream parser + cosine) is the labelled test
   set: fixed input chunks → expected assembled text/`done`; known vectors →
   expected similarity within tolerance. Target: 100% pass.
3. **Feedback capture** — inline error bubbles surface gateway errors verbatim;
   the health banner reports reachability. Runtime issues are visible in-UI
   rather than swallowed.
4. **Review loop** — revisit if the backend contract changes (new endpoints /
   fields) or if a new capability (model manager, persistence) is requested.

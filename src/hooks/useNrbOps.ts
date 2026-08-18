import { useCallback, useEffect, useState } from 'react'
import {
  GatewayError,
  describeError,
  getNrbStatus,
  triggerNrbRun,
  type NrbRun,
  type NrbStatus,
} from '@/lib/api'
import { buildTriggerRequest, type ScopeForm, type TriggerKind } from '@/lib/nrb-format'

/**
 * Modest poll interval. The poll is not an optimisation to be deduped away:
 * `GET /v1/nrb/status` settles finished runs server-side, so it is what advances
 * an `awaiting_jobs` run whose ingest jobs have all completed.
 */
export const NRB_POLL_MS = 5000

export interface NrbOps {
  status: NrbStatus | null
  /**
   * The update in progress, or null. Read from the backend — either
   * `status.active_run` or the run a trigger just returned (202 or 409). Never
   * inferred from a status string: the gateway owns which statuses are active.
   */
  activeRun: NrbRun | null
  loading: boolean
  /** A failed request. The last good status stays on screen alongside it. */
  error: string | null
  /** A signed-in non-admin (403). Distinct from a 401, which ends the session. */
  forbidden: boolean
  /** The gateway's "already in progress" note from a 409. Not an error. */
  conflict: string | null
  submitting: TriggerKind | null
  refresh: () => Promise<void>
  trigger: (kind: TriggerKind, form: ScopeForm) => Promise<void>
}

/**
 * Gateway state for the NRB operations screen.
 *
 * Everything important lives on the server, so a page refresh recovers fully
 * from `GET /v1/nrb/status`. Nothing derived is computed here.
 */
/**
 * Prefer the gateway's own `detail` over `describeError`'s chat-oriented
 * rewording (which turns any 502 into "inference service is unavailable"). Same
 * approach as the department admin console.
 */
function gatewayMessage(err: unknown): string {
  return err instanceof GatewayError ? err.message : describeError(err)
}

export function useNrbOps(): NrbOps {
  const [status, setStatus] = useState<NrbStatus | null>(null)
  const [triggeredRun, setTriggeredRun] = useState<NrbRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<TriggerKind | null>(null)
  // Bumped after every completed request so the poll effect re-arms even when
  // the active run's id has not changed.
  const [tick, setTick] = useState(0)

  const handleFailure = useCallback((err: unknown) => {
    if (err instanceof GatewayError && err.status === 403) {
      setForbidden(true)
      setError(null)
      return
    }
    setError(gatewayMessage(err))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getNrbStatus()
      setStatus(next)
      // The server is authoritative from here on; drop the locally held run.
      setTriggeredRun(null)
      setError(null)
      setForbidden(false)
    } catch (err) {
      // Deliberately does NOT clear `status`: a failed poll must not blank the
      // screen, only report itself.
      handleFailure(err)
    } finally {
      setLoading(false)
      setTick((value) => value + 1)
    }
  }, [handleFailure])

  const trigger = useCallback(
    async (kind: TriggerKind, form: ScopeForm) => {
      setSubmitting(kind)
      setError(null)
      setConflict(null)
      try {
        const result = await triggerNrbRun(buildTriggerRequest(form, kind))
        // Branch on `started` only — 202 and 409 share one envelope, and a 409
        // carries the update already in progress, which must be shown, not lost.
        if (!result.started) {
          setConflict(
            ['An NRB update is already in progress.', result.detail]
              .filter(Boolean)
              .join(' '),
          )
        }
        if (result.run) setTriggeredRun(result.run)
      } catch (err) {
        handleFailure(err)
      } finally {
        setSubmitting(null)
        setTick((value) => value + 1)
      }
    },
    [handleFailure],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load operational state on mount
    void refresh()
  }, [refresh])

  const activeRun = status?.active_run ?? triggeredRun

  useEffect(() => {
    // "Keep polling" is read from the data: no active run, no timer at all.
    if (!activeRun) return
    const timer = window.setTimeout(() => void refresh(), NRB_POLL_MS)
    return () => window.clearTimeout(timer)
  }, [activeRun, refresh, tick])

  return {
    status,
    activeRun: activeRun ?? null,
    loading,
    error,
    forbidden,
    conflict,
    submitting,
    refresh,
    trigger,
  }
}

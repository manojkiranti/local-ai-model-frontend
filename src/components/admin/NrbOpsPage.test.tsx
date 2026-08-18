import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    getNrbStatus: vi.fn(),
    triggerNrbRun: vi.fn(),
  }
})

import {
  GatewayError,
  getNrbStatus,
  triggerNrbRun,
  type Department,
  type NrbRun,
  type NrbStatus,
} from '@/lib/api'
import { NrbOpsPage } from '@/components/admin/NrbOpsPage'

const mockStatus = vi.mocked(getNrbStatus)
const mockTrigger = vi.mocked(triggerNrbRun)

const DEPARTMENTS: Department[] = [
  { id: 1, code: 'research', name: 'Research', is_active: true, created_at: '2026-08-01T00:00:00Z' },
]

function makeRun(overrides: Partial<NrbRun> = {}): NrbRun {
  return {
    id: 7,
    trigger: 'api',
    requested_by: 'admin@odin.test',
    status: 'queued',
    stage: 'sync',
    department: 'research',
    scope: { limit: 25 },
    counters: {},
    error: null,
    jobs: {},
    created_at: '2026-08-17T10:00:00+00:00',
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

function makeStatus(overrides: Partial<NrbStatus> = {}): NrbStatus {
  return {
    active_run: null,
    latest_run: null,
    catalog: { sources: 3 },
    files: { pending: 1 },
    rag: { ready: 0 },
    ...overrides,
  }
}

function renderPage() {
  return render(<NrbOpsPage departments={DEPARTMENTS} />)
}

/**
 * The <dd> for a TOP-LEVEL <dt> of this scope, ignoring nested groups — `ready`
 * exists both as a scalar and inside the `documents` map, and they must not be
 * confused for one another.
 */
function statValue(scope: HTMLElement, label: string): string {
  const nested = Array.from(scope.querySelectorAll('[role="group"]'))
  const dt = Array.from(scope.querySelectorAll('dt')).find(
    (el) => el.textContent === label && !nested.some((group) => group.contains(el)),
  )
  return dt?.nextElementSibling?.textContent ?? ''
}

/** The status word printed in the run's status badge (not a job count key). */
function statusWord(card: HTMLElement, word: string): HTMLElement {
  return within(card).getByText(word, { selector: '[data-nrb-status-label]' })
}

function updateButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Update NRB' }) as HTMLButtonElement
}

function retryButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Retry failed ingest' }) as HTMLButtonElement
}

/** Set a department and one bound — the minimum the gateway accepts. */
function fillBoundedScope() {
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'research' } })
  fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '25' } })
}

beforeEach(() => {
  mockStatus.mockReset()
  mockTrigger.mockReset()
})

afterEach(() => {
  // This repo does not run vitest with `globals`, so RTL's automatic cleanup is
  // never registered — unmount explicitly or the DOM accumulates between tests.
  cleanup()
  vi.useRealTimers()
})

describe('NRB status rendering', () => {
  it('loads the status and renders the counts each block actually returned', async () => {
    mockStatus.mockResolvedValue(
      makeStatus({
        catalog: { sources: 3, files: 18266, brand_new_counter: 4 },
        files: { pending: 2, fetched: 12, bytes_on_disk: 5_242_880 },
        rag: { ready: 4, chunks: 900, documents: { ready: 4, failed: 1 }, jobs: { succeeded: 6 } },
      }),
    )
    renderPage()

    const catalog = await screen.findByRole('region', { name: 'Catalog' })
    expect(statValue(catalog, 'Sources')).toBe('3')
    expect(statValue(catalog, 'Files')).toBe('18,266')
    // A counter key the frontend has never seen still renders.
    expect(statValue(catalog, 'Brand new counter')).toBe('4')

    const files = screen.getByRole('region', { name: 'Files' })
    expect(statValue(files, 'Pending')).toBe('2')
    // Raw bytes must read as a size, not as a count beside the file totals.
    expect(statValue(files, 'Bytes on disk')).toBe('5 MB')

    const rag = screen.getByRole('region', { name: 'RAG' })
    expect(statValue(rag, 'Ready')).toBe('4')
    // Nested maps get their own labelled groups instead of being flattened.
    const documents = within(rag).getByRole('group', { name: 'Documents' })
    expect(statValue(documents, 'Failed')).toBe('1')
    const jobs = within(rag).getByRole('group', { name: 'Jobs' })
    expect(statValue(jobs, 'Succeeded')).toBe('6')
  })

  it('says so when no update has ever run', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    renderPage()
    expect(await screen.findByText('No NRB update has run yet.')).not.toBeNull()
  })

  it('keeps the last good status on screen when a poll fails', async () => {
    mockStatus
      .mockResolvedValueOnce(makeStatus({ active_run: makeRun({ status: 'running' }) }))
      .mockRejectedValue(new GatewayError(502, 'Gateway timeout'))
    vi.useFakeTimers()
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Updating')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mockStatus).toHaveBeenCalledTimes(2)
    // The error is surfaced, but the counts and the run are NOT blanked.
    expect(screen.getByRole('alert').textContent).toContain('Gateway timeout')
    expect(screen.getByText('Updating')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Catalog' })).not.toBeNull()
  })

  it('shows an API error when the first load fails', async () => {
    mockStatus.mockRejectedValue(new GatewayError(502, 'Cannot reach the database'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Cannot reach the database')
  })
})

describe('scope form and actions', () => {
  it('keeps Update disabled until a department and one bound are set', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })

    // No silent default bound: nothing is submittable on arrival.
    expect(updateButton().disabled).toBe(true)
    expect(retryButton().disabled).toBe(true)
    expect(
      screen.getByText('Choose a department — the rag stage ingests into it.'),
    ).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Department'), {
      target: { value: 'research' },
    })
    expect(updateButton().disabled).toBe(true)
    expect(
      screen.getByText(
        'Set at least one bound: limit, years, sections, owners or extensions.',
      ),
    ).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '25' } })
    expect(updateButton().disabled).toBe(false)
    expect(retryButton().disabled).toBe(false)
  })

  it.each([
    ['queued', 'Queued', 'Waiting for the NRB pipeline runner to claim it'],
    ['running', 'Updating', 'The NRB pipeline runner is staging files'],
    ['awaiting_jobs', 'Indexing', 'Staging finished; the RAG worker is still indexing'],
  ])(
    'disables both actions and labels a %s run correctly',
    async (status, label, note) => {
      mockStatus.mockResolvedValue(
        makeStatus({ active_run: makeRun({ status }) }),
      )
      renderPage()
      await screen.findByRole('region', { name: 'Current update' })

      expect(screen.getByText(label)).not.toBeNull()
      expect(screen.getByText(note)).not.toBeNull()
      fillBoundedScope()
      // A bounded scope does not re-enable them: a run is already in progress.
      expect(updateButton().disabled).toBe(true)
      expect(retryButton().disabled).toBe(true)
    },
  )

  it('distinguishes running from awaiting_jobs, which wait on different processes', async () => {
    mockStatus.mockResolvedValue(makeStatus({ active_run: makeRun({ status: 'running' }) }))
    const view = renderPage()
    const running = await screen.findByRole('region', { name: 'Current update' })
    expect(running.getAttribute('data-nrb-status')).toBe('running')
    view.unmount()

    mockStatus.mockResolvedValue(
      makeStatus({ active_run: makeRun({ status: 'awaiting_jobs' }) }),
    )
    renderPage()
    const awaiting = await screen.findByRole('region', { name: 'Current update' })
    expect(awaiting.getAttribute('data-nrb-status')).toBe('awaiting_jobs')
  })

  it('renders and tracks the accepted run on a 202', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockResolvedValue({
      started: true,
      run: makeRun({ id: 11, status: 'queued' }),
      detail: null,
    })
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    fireEvent.click(updateButton())

    const card = await screen.findByRole('region', { name: 'Current update' })
    expect(card.getAttribute('data-nrb-status')).toBe('queued')
    expect(within(card).getByText('Queued')).not.toBeNull()
    expect(statValue(card, 'Run')).toBe('11')
    // Tracking started: the run is now the active one, so the actions are shut.
    expect(updateButton().disabled).toBe(true)
  })

  it('renders the in-progress run on a 409 instead of a generic failure', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockResolvedValue({
      started: false,
      run: makeRun({ id: 9, status: 'running' }),
      detail: 'run 9 is running',
    })
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    fireEvent.click(updateButton())

    const card = await screen.findByRole('region', { name: 'Current update' })
    expect(statValue(card, 'Run')).toBe('9')
    expect(within(card).getByText('Updating')).not.toBeNull()
    expect(screen.getByText('An NRB update is already in progress. run 9 is running')).not.toBeNull()
    // Not an error state: no alert, and the returned run was not discarded.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the detail when a 409 names no run', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockResolvedValue({
      started: false,
      run: null,
      detail: 'the pipeline lock is held',
    })
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    fireEvent.click(updateButton())

    expect(
      await screen.findByText(
        'An NRB update is already in progress. the pipeline lock is held',
      ),
    ).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends the four staging stages for an update', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockResolvedValue({ started: true, run: makeRun(), detail: null })
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    fireEvent.click(updateButton())

    await waitFor(() => expect(mockTrigger).toHaveBeenCalledTimes(1))
    expect(mockTrigger.mock.calls[0][0]).toEqual({
      department: 'research',
      stages: ['sync', 'fetch', 'extract', 'rag'],
      retry_failed: false,
      limit: 25,
    })
  })

  it('sends retry_failed:true with the rag stage only, and only when clicked', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockResolvedValue({
      started: true,
      run: makeRun({ status: 'queued', stage: 'rag' }),
      detail: null,
    })
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    // Filling the form must not trigger anything on its own.
    expect(mockTrigger).not.toHaveBeenCalled()

    fireEvent.click(retryButton())
    await waitFor(() => expect(mockTrigger).toHaveBeenCalledTimes(1))
    expect(mockTrigger.mock.calls[0][0]).toEqual({
      department: 'research',
      stages: ['rag'],
      retry_failed: true,
      limit: 25,
    })
  })

  it('surfaces a rejected scope without inventing a run', async () => {
    mockStatus.mockResolvedValue(makeStatus())
    mockTrigger.mockRejectedValue(new GatewayError(422, 'a bounded scope is required'))
    renderPage()
    await screen.findByRole('region', { name: 'Catalog' })
    fillBoundedScope()
    fireEvent.click(updateButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('a bounded scope is required')
    expect(screen.queryByRole('region', { name: 'Current update' })).toBeNull()
  })
})

describe('terminal results', () => {
  it.each([
    ['succeeded', 'Succeeded'],
    ['partial', 'Completed with failures'],
    ['failed', 'Failed'],
  ])('distinguishes a %s run by word and data attribute, not colour', async (status, label) => {
    mockStatus.mockResolvedValue(
      makeStatus({
        latest_run: makeRun({
          status,
          stage: 'rag',
          started_at: '2026-08-17T10:00:05+00:00',
          finished_at: '2026-08-17T10:04:00+00:00',
          error: status === 'failed' ? 'sync stage raised ConnectionError' : null,
          counters: { files_fetched: 12 },
          jobs: { succeeded: 11, failed: status === 'succeeded' ? 0 : 1 },
        }),
      }),
    )
    renderPage()

    const card = await screen.findByRole('region', { name: 'Latest update' })
    expect(card.getAttribute('data-nrb-status')).toBe(status)
    expect(statusWord(card, label)).not.toBeNull()
    expect(statValue(card, 'Finished')).not.toBe('—')
    // Counters and job counts the API provided are shown.
    expect(within(card).getByText('Files fetched')).not.toBeNull()
    // Actions are available again: nothing is active.
    expect(screen.queryByRole('region', { name: 'Current update' })).toBeNull()
  })

  it('shows the failure text of a failed run', async () => {
    mockStatus.mockResolvedValue(
      makeStatus({
        latest_run: makeRun({ status: 'failed', error: 'sync stage raised ConnectionError' }),
      }),
    )
    renderPage()
    expect(await screen.findByText('sync stage raised ConnectionError')).not.toBeNull()
  })
})

describe('polling', () => {
  it('does not poll when no run is active', async () => {
    mockStatus.mockResolvedValue(makeStatus({ latest_run: makeRun({ status: 'succeeded' }) }))
    vi.useFakeTimers()
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mockStatus).toHaveBeenCalledTimes(1)
  })

  it('polls while a run is active and stops once none remains', async () => {
    mockStatus
      .mockResolvedValueOnce(makeStatus({ active_run: makeRun({ status: 'awaiting_jobs' }) }))
      .mockResolvedValue(makeStatus({ latest_run: makeRun({ status: 'succeeded' }) }))
    vi.useFakeTimers()
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockStatus).toHaveBeenCalledTimes(1)

    // The poll is what advances an awaiting_jobs run whose jobs have finished.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mockStatus).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Succeeded')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mockStatus).toHaveBeenCalledTimes(2)
  })
})

describe('non-admin', () => {
  it('says the account is not an administrator on a 403 and does not clear the session', async () => {
    mockStatus.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    renderPage()
    expect(
      await screen.findByText('This account is not an administrator.'),
    ).not.toBeNull()
    // A 403 is a different state from a 401: no scope form, no generic error.
    expect(screen.queryByRole('button', { name: 'Update NRB' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Catalog' })).toBeNull()
  })
})

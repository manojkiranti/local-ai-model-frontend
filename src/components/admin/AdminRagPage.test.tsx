import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    archiveDepartmentDocument: vi.fn(),
    createDepartment: vi.fn(),
    createDepartmentTextDocument: vi.fn(),
    getIngestJob: vi.fn(),
    grantDepartmentMember: vi.fn(),
    listDepartmentDocuments: vi.fn(),
    listDepartmentMembers: vi.fn(),
    listUsers: vi.fn(),
    revokeDepartmentMember: vi.fn(),
    updateDepartment: vi.fn(),
    uploadDepartmentDocument: vi.fn(),
  }
})

import {
  GatewayError,
  getIngestJob,
  grantDepartmentMember,
  listDepartmentDocuments,
  listDepartmentMembers,
  listUsers,
  uploadDepartmentDocument,
  type Department,
  type DepartmentDocument,
  type DepartmentMember,
  type DepartmentRole,
  type UserOut,
} from '@/lib/api'
import { AdminRagPage } from '@/components/admin/AdminRagPage'

const mockDocuments = vi.mocked(listDepartmentDocuments)
const mockMembers = vi.mocked(listDepartmentMembers)
const mockUsers = vi.mocked(listUsers)
const mockGrant = vi.mocked(grantDepartmentMember)
const mockUpload = vi.mocked(uploadDepartmentDocument)
const mockJob = vi.mocked(getIngestJob)

function department(role: DepartmentRole, overrides: Partial<Department> = {}): Department {
  return {
    id: 1,
    code: 'finance',
    name: 'Finance',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    role,
    ...overrides,
  }
}

function document(overrides: Partial<DepartmentDocument> = {}): DepartmentDocument {
  return {
    id: 'doc-1',
    department_id: 1,
    title: 'Lending policy',
    source: 'upload',
    file_type: 'pdf',
    file_name: 'lending.pdf',
    status: 'ready',
    chunk_count: 12,
    created_at: '2026-08-02T00:00:00Z',
    ...overrides,
  }
}

function member(overrides: Partial<DepartmentMember> = {}): DepartmentMember {
  return {
    user_id: 7,
    department_id: 1,
    role: 'viewer',
    email: 'nina@odin.test',
    granted_by: 1,
    granted_at: '2026-08-03T00:00:00Z',
    ...overrides,
  }
}

function user(overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 11,
    email: 'alice@odin.test',
    auth_provider: 'local',
    role: 'member',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function renderWith(dept: Department, isAdmin = false) {
  return render(
    <AdminRagPage departments={[dept]} onDepartmentsChanged={async () => {}} isAdmin={isAdmin} />,
  )
}

async function renderPage(role: DepartmentRole, isAdmin = false) {
  const view = render(
    <AdminRagPage
      departments={[department(role)]}
      onDepartmentsChanged={async () => {}}
      isAdmin={isAdmin}
    />,
  )
  await waitFor(() => expect(mockDocuments).toHaveBeenCalled())
  return view
}

describe('AdminRagPage levels', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([member()])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // A viewer reads the corpus and chats. Every curation control is the gateway's
  // editor level, so none of them may be drawn.
  it('gives a viewer no curation controls and no members screen', async () => {
    await renderPage('viewer')
    expect(screen.queryByRole('button', { name: /Queue upload/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Queue text/ })).toBeNull()
    expect(screen.queryByLabelText('Include archived')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive Lending policy' })).toBeNull()
    expect(screen.queryByText('Member access')).toBeNull()
    expect(screen.getByText('Lending policy')).not.toBeNull()
  })

  it('does not request members or the user list for a viewer', async () => {
    await renderPage('viewer')
    expect(mockMembers).not.toHaveBeenCalled()
    expect(mockUsers).not.toHaveBeenCalled()
  })

  it('gives an editor the curation controls but no members screen', async () => {
    await renderPage('editor')
    expect(screen.getByRole('button', { name: /Queue upload/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /Queue text/ })).not.toBeNull()
    expect(screen.getByLabelText('Include archived')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Archive Lending policy' })).not.toBeNull()
    expect(screen.queryByText('Member access')).toBeNull()
    expect(mockMembers).not.toHaveBeenCalled()
  })

  it('gives an owner the members screen', async () => {
    await renderPage('owner')
    await waitFor(() => expect(mockMembers).toHaveBeenCalledWith('finance'))
    expect(screen.getByText('Member access')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Queue upload/ })).not.toBeNull()
  })

  // MemberOut carries the email precisely so an owner, who cannot read
  // `GET /users`, is not left staring at bare integers.
  it('identifies members by the email the members route returns', async () => {
    mockMembers.mockResolvedValue([member({ email: 'omar@odin.test', role: 'editor' })])
    await renderPage('owner')
    await waitFor(() => expect(screen.getByText('omar@odin.test')).not.toBeNull())
    expect(mockUsers).not.toHaveBeenCalled()
    const row = screen.getByText('omar@odin.test').closest('div')!
    expect(within(row).getByDisplayValue('Editor')).not.toBeNull()
  })

  // `GET /users` is still global-admin-only, so an owner must never call it —
  // the 403 would kill the whole screen's load.
  it('reads the user directory only for a global admin', async () => {
    await renderPage('owner', true)
    await waitFor(() => expect(mockUsers).toHaveBeenCalled())
  })
})

describe('AdminRagPage global-admin controls', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // Creating, renaming and disabling a department are `require_admin` routes.
  // Owner is a level INSIDE a department and does not reach them.
  it('hides department create, rename and disable from a non-admin owner', async () => {
    await renderPage('owner')
    expect(screen.queryByText('Create department')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull()
  })

  it('shows department create, rename and disable to a global admin', async () => {
    await renderPage('owner', true)
    expect(screen.getByText('Create department')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save name' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Disable' })).not.toBeNull()
  })
})

describe('AdminRagPage refusals', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // An escalation refusal is not an auth failure: the message is the server's,
  // shown verbatim, and what the owner typed survives so they can hand it to an
  // admin instead.
  it('renders a 403 escalation refusal verbatim and keeps the recipient for retry', async () => {
    mockGrant.mockRejectedValue(
      new GatewayError(403, 'Only a global admin can grant owner access to a department'),
    )
    await renderPage('owner')
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nina@odin.test' },
    })
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'owner' } })
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))

    await waitFor(() =>
      expect(
        screen.getByText('Only a global admin can grant owner access to a department'),
      ).not.toBeNull(),
    )
    expect(screen.getByText(/Ask a global admin/)).not.toBeNull()
    // The address survives as a chip so it can be handed to an admin instead of
    // retyped.
    expect(screen.getByRole('button', { name: 'Remove nina@odin.test' })).not.toBeNull()
  })

  it('renders the editor refusal from a rejected upload verbatim', async () => {
    mockUpload.mockRejectedValue(
      new GatewayError(403, 'Editor access to this department is required'),
    )
    await renderPage('editor')
    fireEvent.change(screen.getByLabelText('Document file'), {
      target: { files: [new File(['x'], 'rates.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.submit(screen.getByRole('button', { name: /Queue upload/ }).closest('form')!)
    await waitFor(() =>
      expect(screen.getByText('Editor access to this department is required')).not.toBeNull(),
    )
  })

  it('keeps polling a live job and reloads the corpus when it finishes', async () => {
    mockUpload.mockResolvedValue({ document_id: 'doc-9', job_id: 'job-9', status: 'queued' })
    const running = {
      id: 'job-9', document_id: 'doc-9', status: 'running' as const, chunks_total: 4,
      chunks_done: 2, attempts: 1, error: null, created_at: '2026-08-04T00:00:00Z',
      finished_at: null,
    }
    mockJob
      .mockResolvedValueOnce(running)
      .mockResolvedValue({ ...running, status: 'succeeded', chunks_done: 4, finished_at: '2026-08-04T00:01:00Z' })
    await renderPage('editor')
    fireEvent.change(screen.getByLabelText('Document file'), {
      target: { files: [new File(['x'], 'rates.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.submit(screen.getByRole('button', { name: /Queue upload/ }).closest('form')!)
    await waitFor(() => expect(mockUpload).toHaveBeenCalled())
    const loadsBefore = mockDocuments.mock.calls.length

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(screen.getByText('running')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(mockJob).toHaveBeenCalledTimes(2)
    expect(screen.getByText('succeeded')).not.toBeNull()
    // A finished job means the document list changed underneath us.
    expect(mockDocuments.mock.calls.length).toBeGreaterThan(loadsBefore)
  })

  // `GET /v1/ingest-jobs/{id}` answers 404 — not 403 — when you may not see it,
  // so it can never become available. Retrying is a poll that never ends.
  it('stops polling an ingest job that answers 404', async () => {
    mockUpload.mockResolvedValue({ document_id: 'doc-9', job_id: 'job-9', status: 'queued' })
    mockJob.mockRejectedValue(new GatewayError(404, 'Unknown ingest job'))
    await renderPage('editor')
    fireEvent.change(screen.getByLabelText('Document file'), {
      target: { files: [new File(['x'], 'rates.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.submit(screen.getByRole('button', { name: /Queue upload/ }).closest('form')!)
    await waitFor(() => expect(mockUpload).toHaveBeenCalled())

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(mockJob).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mockJob).toHaveBeenCalledTimes(1)
  })
})

describe('AdminRagPage granting', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([member({ user_id: 7, email: 'nina@odin.test' })])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
    mockGrant.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // The whole point of the email path: an owner cannot read `GET /users`, so the
  // address is what they have, and the gateway resolves it server-side.
  it('grants a new member by email at the chosen level', async () => {
    await renderPage('owner')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'omar@odin.test' } })
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'editor' } })
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))

    await waitFor(() =>
      expect(mockGrant).toHaveBeenCalledWith('finance', { email: 'omar@odin.test' }, 'editor'),
    )
    // A grant that succeeded clears the field and leaves no chip behind.
    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(''),
    )
    expect(screen.queryByRole('button', { name: 'Remove omar@odin.test' })).toBeNull()
  })

  // Same endpoint, addressed by id because this member is already listed.
  it('changes an existing member level by user id', async () => {
    await renderPage('owner')
    await waitFor(() => expect(screen.getByText('nina@odin.test')).not.toBeNull())
    fireEvent.change(screen.getByLabelText('Level for nina@odin.test'), {
      target: { value: 'owner' },
    })
    await waitFor(() =>
      expect(mockGrant).toHaveBeenCalledWith('finance', { user_id: 7 }, 'owner'),
    )
  })
})

describe('AdminRagPage grant level semantics', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([member({ user_id: 7, email: 'nina@odin.test', role: 'owner' })])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
    mockGrant.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // The endpoint upserts, so sending a level nobody chose silently demotes an
  // existing member. The level control therefore starts UNSET, not at 'viewer'.
  it('sends no level when the granter did not choose one', async () => {
    await renderPage('owner')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'omar@odin.test' } })
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))
    await waitFor(() =>
      expect(mockGrant).toHaveBeenCalledWith('finance', { email: 'omar@odin.test' }, undefined),
    )
  })

  it('starts the level control unset so viewer is never sent by accident', async () => {
    await renderPage('owner')
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('')
  })

  // A deactivated account is refused with 409, and the fix is reactivation —
  // not an escalation, so the "ask an admin to make this change" hint would
  // point at the wrong change.
  it('renders the 409 deactivated-account refusal verbatim, without the escalation hint', async () => {
    mockGrant.mockRejectedValue(
      new GatewayError(409, 'That account is deactivated; reactivate it before granting access'),
    )
    await renderPage('owner')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'gone@odin.test' } })
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))
    await waitFor(() =>
      expect(
        screen.getByText('That account is deactivated; reactivate it before granting access'),
      ).not.toBeNull(),
    )
    expect(screen.queryByText(/Ask a global admin/)).toBeNull()
  })
})

describe('AdminRagPage inactive departments', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([])
    mockMembers.mockResolvedValue([member({ email: 'nina@odin.test' })])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // Grants outlive `is_active = false` on purpose: offboarding someone must not
  // require reactivating a retired department. Only the CORPUS routes 404 there.
  it('still manages members of a soft-disabled department', async () => {
    renderWith(department('owner', { is_active: false }), true)
    await waitFor(() => expect(mockMembers).toHaveBeenCalledWith('finance'))
    expect(screen.getByText('nina@odin.test')).not.toBeNull()
    expect(screen.queryByText(/Enable this department to manage its members/)).toBeNull()
  })

  it('does not ask for the corpus of a soft-disabled department', async () => {
    renderWith(department('editor', { is_active: false }), true)
    await waitFor(() => expect(screen.getByText(/Enable this department before/)).not.toBeNull())
    expect(mockDocuments).not.toHaveBeenCalled()
  })
})

describe('AdminRagPage missing level', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([])
    mockUsers.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // `role` is required and closed now, so an absent one means we are talking to
  // a gateway without feat/role. Fail closed AND say so — silently hiding every
  // control is the exact failure this contract was tightened to prevent.
  it('says so when the gateway reports no level, instead of just hiding everything', async () => {
    renderWith(department(undefined as unknown as DepartmentRole))
    await waitFor(() =>
      expect(screen.getByText(/did not report your access level/)).not.toBeNull(),
    )
    expect(screen.queryByRole('button', { name: /Queue upload/ })).toBeNull()
    expect(screen.queryByText('Member access')).toBeNull()
  })
})

describe('AdminRagPage batch granting', () => {
  beforeEach(() => {
    mockDocuments.mockResolvedValue([document()])
    mockMembers.mockResolvedValue([])
    mockUsers.mockResolvedValue({
      total: 2,
      limit: 50,
      offset: 0,
      items: [user({ id: 11, email: 'alice@odin.test' }), user({ id: 12, email: 'bob@odin.test' })],
    })
    mockGrant.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // Offboarding aside, the common admin task is onboarding several people at
  // once. Pick two from the directory, choose one level, grant once.
  it('grants several directory users in one action at the chosen level', async () => {
    await renderPage('owner', true)
    fireEvent.click(screen.getByRole('button', { name: /Add from directory/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'alice@odin.test' }))
    fireEvent.click(screen.getByRole('button', { name: 'bob@odin.test' }))
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'editor' } })
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))

    await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(2))
    expect(mockGrant).toHaveBeenCalledWith('finance', { email: 'alice@odin.test' }, 'editor')
    expect(mockGrant).toHaveBeenCalledWith('finance', { email: 'bob@odin.test' }, 'editor')
    // The corpus/members reload once the batch settles.
    await waitFor(() => expect(mockMembers.mock.calls.length).toBeGreaterThan(1))
  })

  // A refusal on one recipient must not abort the rest, and it must not log the
  // owner out (403 is never an auth failure). The failed one stays a chip.
  it('reports a partial failure without aborting the batch or logging out', async () => {
    mockGrant
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new GatewayError(403, 'Only a global admin can grant owner access to a department'),
      )
    await renderPage('owner', true)
    fireEvent.click(screen.getByRole('button', { name: /Add from directory/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'alice@odin.test' }))
    fireEvent.click(screen.getByRole('button', { name: 'bob@odin.test' }))
    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))

    await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.getByText('Only a global admin can grant owner access to a department'),
      ).not.toBeNull(),
    )
    // Succeeded chip cleared, failed chip kept for another try.
    expect(screen.queryByRole('button', { name: 'Remove alice@odin.test' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove bob@odin.test' })).not.toBeNull()
  })

  // An owner cannot read `GET /users`, so no directory picker is offered — the
  // typed-email path is all they have.
  it('offers no directory picker to a non-admin owner', async () => {
    await renderPage('owner')
    expect(screen.queryByRole('button', { name: /Add from directory/ })).toBeNull()
  })

  it('offers the directory picker to a global admin', async () => {
    await renderPage('owner', true)
    expect(screen.getByRole('button', { name: /Add from directory/ })).not.toBeNull()
  })

  // Typing an address and pressing Enter queues it as a chip; this is how an
  // owner assembles a batch without a directory.
  it('queues a typed address as a chip on Enter', async () => {
    await renderPage('owner')
    const email = screen.getByLabelText('Email')
    fireEvent.change(email, { target: { value: 'ext@partner.test' } })
    fireEvent.submit(email.closest('form')!)
    expect(screen.getByRole('button', { name: 'Remove ext@partner.test' })).not.toBeNull()
    expect((email as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /^Grant/ }))
    await waitFor(() =>
      expect(mockGrant).toHaveBeenCalledWith('finance', { email: 'ext@partner.test' }, undefined),
    )
  })
})

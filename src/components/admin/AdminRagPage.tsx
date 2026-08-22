import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  FilePlus2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  archiveDepartmentDocument,
  createDepartment,
  createDepartmentTextDocument,
  describeError,
  GatewayError,
  getIngestJob,
  grantDepartmentMember,
  listDepartmentDocuments,
  listDepartmentMembers,
  listUsers,
  revokeDepartmentMember,
  updateDepartment,
  uploadDepartmentDocument,
  type Department,
  type DepartmentDocument,
  type DepartmentMember,
  type DepartmentRole,
  type IngestAccepted,
  type IngestJob,
  type UserOut,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { atLeast, DEPARTMENT_LEVELS, isDepartmentRole } from '@/lib/department-scopes'
import { documentTitleFromFilename } from '@/lib/rag-document'

const DOCUMENT_ACCEPT = '.pdf,.docx,.xlsx,.csv'

const SELECT_CLASS = 'h-9 w-full rounded-md border bg-background px-3 text-sm'

/** One poll: fresh progress, or the id whose progress became unreadable. */
type PollResult = { job: IngestJob } | { failed: string; reason: string }

function ragError(error: unknown): string {
  return error instanceof GatewayError ? error.message : describeError(error)
}

function statusVariant(status: string): 'default' | 'outline' {
  if (status === 'ready' || status === 'succeeded') return 'default'
  return 'outline'
}

function levelLabel(level: DepartmentRole): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

interface AdminRagPageProps {
  departments: Department[]
  onDepartmentsChanged: () => Promise<void>
  isAdmin: boolean
}

/** Admin console for departments, corpus ingestion, and access grants. */
export function AdminRagPage({
  departments,
  onDepartmentsChanged,
  isAdmin,
}: AdminRagPageProps) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DepartmentDocument[]>([])
  const [members, setMembers] = useState<DepartmentMember[]>([])
  const [users, setUsers] = useState<UserOut[]>([])
  const [jobs, setJobs] = useState<Record<string, IngestJob>>({})
  const [unpollable, setUnpollable] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [editName, setEditName] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadInputKey, setUploadInputKey] = useState(0)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  // The batch of addresses queued for a single grant. The live `grantEmail`
  // field feeds it (Enter, or implicitly at grant time), and the directory
  // picker toggles entries in and out of it.
  const [recipients, setRecipients] = useState<string[]>([])
  // Per-recipient refusals from the last batch, rendered under the notice so a
  // 403 on one address never hides the ones that went through.
  const [grantFailures, setGrantFailures] = useState<{ email: string; detail: string }[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  // '' means "the granter chose no level", which is NOT the same as 'viewer':
  // the endpoint upserts, so sending a level nobody picked demotes an existing
  // member. Absent keeps their level (and lands a new member on viewer).
  const [grantLevel, setGrantLevel] = useState<DepartmentRole | ''>('')

  const announce = useCallback((message: string | null) => {
    setNotice(message)
    setRefused(false)
  }, [])

  // A 403 here is never an auth failure — the caller is signed in and simply
  // lacks the level, or is an owner reaching past what an owner may delegate.
  // Render the gateway's `detail` verbatim and point them at an admin; never
  // retry, and never let it reach the unauthorized handler (only 401 does).
  const report = useCallback((error: unknown) => {
    setNotice(ragError(error))
    setRefused(error instanceof GatewayError && error.status === 403)
  }, [])

  const effectiveSelectedCode =
    selectedCode && departments.some((department) => department.code === selectedCode)
      ? selectedCode
      : departments[0]?.code ?? null
  const selected =
    departments.find((department) => department.code === effectiveSelectedCode) ?? null

  // The caller's level in the selected department is the ONE input to what this
  // screen draws inside it. `atLeast` fails closed, so an unknown or missing
  // level shows nothing rather than a control the gateway would refuse.
  const canCurate = atLeast(selected?.role, 'editor')
  const canManageMembers = atLeast(selected?.role, 'owner')
  const knownLevel = isDepartmentRole(selected?.role)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the selected server record into the edit field
    setEditName(selected?.name ?? '')
  }, [selected])

  const loadDepartment = useCallback(async () => {
    if (!effectiveSelectedCode || !selected) return
    setLoading(true)
    setNotice(null)
    setRefused(false)
    try {
      const [nextDocuments, nextMembers, userPage] = await Promise.all([
        selected.is_active
          ? listDepartmentDocuments(
              effectiveSelectedCode,
              // `?include_archived=true` is 403 for a viewer, and one refusal
              // would take the whole screen's load down with it.
              includeArchived && atLeast(selected.role, 'editor'),
            )
          : Promise.resolve<DepartmentDocument[]>([]),
        // Owner-or-admin, and deliberately NOT gated on the department being
        // active: grants outlive `is_active = false` so that offboarding someone
        // never requires reactivating a retired department.
        canManageMembers
          ? listDepartmentMembers(effectiveSelectedCode)
          : Promise.resolve<DepartmentMember[]>([]),
        // `GET /users` is still global-admin-only. An owner asking would 403 and
        // lose the members list with it, which is the whole reason `MemberOut`
        // carries an email.
        isAdmin ? listUsers() : Promise.resolve(null),
      ])
      setDocuments(nextDocuments)
      setMembers(nextMembers)
      setUsers(userPage?.items ?? [])
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }, [canManageMembers, effectiveSelectedCode, includeArchived, isAdmin, report, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per-department polling state before loading the next corpus
    setJobs({})
    setUnpollable({})
    // A queued batch belongs to the department it was assembled in.
    setRecipients([])
    setGrantEmail('')
    setGrantFailures([])
    setPickerQuery('')
    void loadDepartment()
  }, [loadDepartment])

  // A job whose progress became unreadable (404) can never come back, so it is
  // dropped from the poll set rather than retried forever.
  const activeJobs = useMemo(
    () =>
      Object.values(jobs).filter(
        (job) => (job.status === 'queued' || job.status === 'running') && !unpollable[job.id],
      ),
    [jobs, unpollable],
  )

  useEffect(() => {
    if (!activeJobs.length) return
    const timer = window.setTimeout(() => {
      void Promise.all(
        activeJobs.map(async (job): Promise<PollResult> => {
          try {
            return { job: await getIngestJob(job.id) }
          } catch (error) {
            // 404 — not 403 — means we may not see this job (or it is gone); it
            // can never become visible, so stop polling it. Other errors leave
            // the job in place to be retried on the next tick.
            if (error instanceof GatewayError && error.status === 404) {
              return { failed: job.id, reason: ragError(error) }
            }
            return { job }
          }
        }),
      ).then((results) => {
        const fresh = results
          .filter((result): result is { job: IngestJob } => 'job' in result)
          .map((result) => result.job)
        const lost = results.filter(
          (result): result is { failed: string; reason: string } => 'failed' in result,
        )
        if (lost.length) {
          setUnpollable((current) => {
            const next = { ...current }
            for (const item of lost) next[item.failed] = item.reason
            return next
          })
        }
        if (fresh.length) {
          setJobs((current) => {
            const next = { ...current }
            for (const job of fresh) next[job.id] = job
            return next
          })
        }
        if (fresh.some((job) => job.status === 'succeeded' || job.status === 'failed')) {
          void loadDepartment()
        }
      })
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [activeJobs, loadDepartment])

  async function createNewDepartment(event: FormEvent) {
    event.preventDefault()
    const code = newCode.trim()
    const name = newName.trim()
    if (!code || !name) return
    setBusy('create-department')
    announce(null)
    try {
      const created = await createDepartment({ code, name })
      await onDepartmentsChanged()
      setSelectedCode(created.code)
      setNewCode('')
      setNewName('')
      announce(`Created ${created.name}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  async function saveDepartment() {
    if (!selected) return
    setBusy('save-department')
    announce(null)
    try {
      await updateDepartment(selected.code, { name: editName.trim() })
      await onDepartmentsChanged()
      announce('Department updated')
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  async function toggleDepartment() {
    if (!selected) return
    setBusy('toggle-department')
    announce(null)
    try {
      await updateDepartment(selected.code, { is_active: !selected.is_active })
      await onDepartmentsChanged()
      announce(selected.is_active ? 'Department disabled' : 'Department enabled')
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  function queueAccepted(accepted: IngestAccepted) {
    setJobs((current) => ({
      ...current,
      [accepted.job_id]: {
        id: accepted.job_id,
        document_id: accepted.document_id,
        status: 'queued',
        chunks_total: null,
        chunks_done: 0,
        attempts: 0,
        error: null,
        created_at: new Date().toISOString(),
        finished_at: null,
      },
    }))
  }

  async function submitUpload(event: FormEvent) {
    event.preventDefault()
    if (!selected || !uploadFile || !uploadTitle.trim()) return
    setBusy('upload')
    announce(null)
    try {
      const accepted = await uploadDepartmentDocument(
        selected.code,
        uploadTitle.trim(),
        uploadFile,
      )
      queueAccepted(accepted)
      setUploadTitle('')
      setUploadFile(null)
      setUploadInputKey((value) => value + 1)
      announce('Document queued for ingestion')
      await loadDepartment()
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  async function submitText(event: FormEvent) {
    event.preventDefault()
    if (!selected || !textTitle.trim() || !textContent.trim()) return
    setBusy('text')
    announce(null)
    try {
      const accepted = await createDepartmentTextDocument(selected.code, {
        title: textTitle.trim(),
        content: textContent.trim(),
      })
      queueAccepted(accepted)
      setTextTitle('')
      setTextContent('')
      announce('Text queued for ingestion')
      await loadDepartment()
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  async function archiveDocument(document: DepartmentDocument) {
    if (!selected || !window.confirm(`Archive “${document.title}”?`)) return
    setBusy(document.id)
    announce(null)
    try {
      await archiveDepartmentDocument(selected.code, document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      announce('Document archived')
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  function addRecipient(email: string) {
    const trimmed = email.trim()
    if (!trimmed) return
    setRecipients((current) =>
      current.includes(trimmed) ? current : [...current, trimmed],
    )
  }

  function toggleRecipient(email: string) {
    setRecipients((current) =>
      current.includes(email)
        ? current.filter((item) => item !== email)
        : [...current, email],
    )
  }

  function removeRecipient(email: string) {
    setRecipients((current) => current.filter((item) => item !== email))
  }

  // Enter (or the form submit) parks the typed address in the batch so several
  // can be queued before granting; the field clears for the next one.
  function queueTypedRecipient(event: FormEvent) {
    event.preventDefault()
    if (!grantEmail.trim()) return
    addRecipient(grantEmail)
    setGrantEmail('')
  }

  async function grantMembers() {
    if (!selected) return
    // Be forgiving: a lone address left in the field, never pressed into a
    // chip, still counts — nobody should lose a grant to a missed Enter.
    const typed = grantEmail.trim()
    const queue = typed && !recipients.includes(typed) ? [...recipients, typed] : [...recipients]
    if (queue.length === 0) return

    setBusy('grant')
    announce(null)
    setGrantFailures([])
    const failures: { email: string; detail: string }[] = []
    let anyForbidden = false
    let granted = 0
    // Sequential on purpose: a refusal on one address must not abort the rest,
    // and the outcome list stays ordered and easy to reason about.
    for (const email of queue) {
      try {
        await grantDepartmentMember(selected.code, { email }, grantLevel || undefined)
        granted += 1
      } catch (error) {
        failures.push({ email, detail: ragError(error) })
        if (error instanceof GatewayError && error.status === 403) anyForbidden = true
      }
    }

    // Succeeded addresses leave the batch; refused ones stay as chips so they
    // can be handed to an admin or retried without retyping.
    setRecipients(failures.map((failure) => failure.email))
    setGrantEmail('')
    // Reload first — loadDepartment clears the notice on entry, so the summary
    // has to be set after it, or it would be wiped.
    await loadDepartment()

    if (failures.length === 0) {
      announce(
        grantLevel
          ? `Granted ${levelLabel(grantLevel)} access to ${granted} ${granted === 1 ? 'member' : 'members'}`
          : `Access granted to ${granted} ${granted === 1 ? 'member' : 'members'}`,
      )
    } else {
      setGrantFailures(failures)
      setRefused(anyForbidden)
      setNotice(
        granted > 0
          ? `Added ${granted}, ${failures.length} skipped`
          : `${failures.length} could not be added`,
      )
    }
    setBusy(null)
  }

  // Promote/demote is the same POST, addressed by id since this member is
  // already listed. Whether it is allowed depends on the caller's global role
  // AND the target's current level — facts the server holds, not this client, so
  // the control stays enabled and the refusal is rendered.
  async function changeMemberLevel(member: DepartmentMember, level: DepartmentRole) {
    if (!selected || level === member.role) return
    setBusy(`member-${member.user_id}`)
    announce(null)
    try {
      await grantDepartmentMember(selected.code, { user_id: member.user_id }, level)
      await loadDepartment()
      announce(`${member.email} is now ${levelLabel(level)}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  async function revokeMember(member: DepartmentMember) {
    if (!selected) return
    setBusy(`member-${member.user_id}`)
    announce(null)
    try {
      await revokeDepartmentMember(selected.code, member.user_id)
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id))
      announce('Access revoked')
    } catch (error) {
      report(error)
    } finally {
      setBusy(null)
    }
  }

  const memberEmails = new Set(members.map((member) => member.email))
  const availableUsers = users.filter(
    (user) => !memberEmails.has(user.email) && user.is_active,
  )
  const pickerQ = pickerQuery.trim().toLowerCase()
  const pickerCandidates = pickerQ
    ? availableUsers.filter((user) => user.email.toLowerCase().includes(pickerQ))
    : availableUsers
  // The typed field counts as a pending grant even before it is pressed into a
  // chip, so the button label and its disabled state match what a click does.
  const typedGrant = grantEmail.trim()
  const pendingGrants =
    recipients.length + (typedGrant && !recipients.includes(typedGrant) ? 1 : 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Department RAG</h1>
            <p className="text-xs text-muted-foreground">Manage knowledge, ingestion, and member access.</p>
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => void loadDepartment()}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </header>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p>{notice}</p>
              {refused && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ask a global admin to make this change.
                </p>
              )}
              {grantFailures.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {grantFailures.map((failure) => (
                    <li key={failure.email} className="flex flex-wrap gap-x-1.5">
                      <span className="font-medium">{failure.email}</span>
                      <span className="text-muted-foreground">{failure.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Creating a department is a global-admin route; an in-department owner
            does not reach it. */}
        {isAdmin && (
          <section className="mb-5 rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-primary" /> Create department
            </div>
            <form onSubmit={createNewDepartment} className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
              <Input
                value={newCode}
                onChange={(event) => setNewCode(event.target.value.toLowerCase())}
                placeholder="code (e.g. finance)"
                pattern="^[a-z0-9][a-z0-9._-]*$"
                maxLength={32}
                required
              />
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Department name" maxLength={128} required />
              <Button type="submit" disabled={busy === 'create-department'}>
                {busy === 'create-department' && <Loader2 className="animate-spin" />} Create
              </Button>
            </form>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="h-fit rounded-xl border bg-card p-2">
            <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Departments</div>
            {departments.map((department) => (
              <button
                key={department.id}
                type="button"
                onClick={() => setSelectedCode(department.code)}
                className={cn(
                  'mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                  effectiveSelectedCode === department.code ? 'bg-primary/10 font-semibold' : 'hover:bg-muted',
                )}
              >
                <Building2 className={cn('size-4', department.is_active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1 truncate">{department.name}</span>
                {!department.is_active && <Badge variant="outline">Off</Badge>}
              </button>
            ))}
            {!departments.length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {isAdmin ? 'Create the first department above.' : 'No departments are shared with you.'}
              </p>
            )}
          </aside>

          {selected ? (
            !knownLevel ? (
              // `role` is required and closed on the current contract, so an
              // absent level means an older gateway. Fail closed AND say so.
              <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
                This gateway did not report your access level for this department, so no
                controls are shown. It is likely running a version without per-department
                roles.
              </div>
            ) : (
              <main className="space-y-5">
                <section className="rounded-xl border bg-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="font-semibold">{selected.name}</h2>
                    <Badge variant="outline" className="font-mono">{selected.code}</Badge>
                    <Badge variant={selected.is_active ? 'default' : 'outline'} className={!selected.is_active ? 'text-destructive' : undefined}>{selected.is_active ? 'Active' : 'Disabled'}</Badge>
                  </div>
                  {/* Renaming and enabling/disabling a department are global-admin
                      routes, so an in-department owner is not offered them. */}
                  {isAdmin && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={128} />
                      <Button variant="outline" onClick={() => void saveDepartment()} disabled={!editName.trim() || busy === 'save-department'}>Save name</Button>
                      <Button variant={selected.is_active ? 'destructive' : 'default'} onClick={() => void toggleDepartment()} disabled={busy === 'toggle-department'}>
                        {selected.is_active ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border bg-card p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <h2 className="font-semibold">Documents</h2>
                    {canCurate && (
                      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
                        Include archived
                      </label>
                    )}
                  </div>

                  {!selected.is_active && (
                    <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Enable this department before managing its corpus.</p>
                  )}

                  {/* Curation is the gateway's editor level; a viewer reads the
                      corpus but is offered no ingestion. */}
                  {canCurate && selected.is_active && (
                    <div className="grid gap-4 xl:grid-cols-2">
                      <form onSubmit={submitUpload} className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Upload className="size-4" /> Upload file</div>
                        <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Document title" aria-label="Document title" required disabled={!selected.is_active} />
                        <Input
                          key={uploadInputKey}
                          type="file"
                          accept={DOCUMENT_ACCEPT}
                          aria-label="Document file"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null
                            setUploadFile(file)
                            if (file) setUploadTitle(documentTitleFromFilename(file.name))
                          }}
                          required
                          disabled={!selected.is_active}
                        />
                        <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, or CSV. Ingestion continues asynchronously.</p>
                        <Button type="submit" size="sm" disabled={!selected.is_active || !uploadFile || busy === 'upload'}>
                          {busy === 'upload' ? <Loader2 className="animate-spin" /> : <FilePlus2 />} Queue upload
                        </Button>
                      </form>

                      <form onSubmit={submitText} className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" /> Add typed text</div>
                        <Input value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="Document title" aria-label="Text title" required disabled={!selected.is_active} />
                        <Textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} placeholder="Knowledge content" className="min-h-24" required disabled={!selected.is_active} />
                        <Button type="submit" size="sm" disabled={!selected.is_active || busy === 'text'}>
                          {busy === 'text' ? <Loader2 className="animate-spin" /> : <Plus />} Queue text
                        </Button>
                      </form>
                    </div>
                  )}

                  {Object.values(jobs).length > 0 && (
                    <div className="mt-4 space-y-2">
                      {Object.values(jobs).map((job) => {
                        const total = job.chunks_total ?? 0
                        const percent = total > 0 ? Math.min(100, Math.round((job.chunks_done / total) * 100)) : 0
                        const lost = unpollable[job.id]
                        return (
                          <div key={job.id} className="rounded-lg border px-3 py-2 text-xs">
                            <div className="flex items-center gap-2">
                              {job.status === 'succeeded' ? <CheckCircle2 className="size-4 text-green-600" /> : job.status === 'failed' || lost ? <XCircle className="size-4 text-destructive" /> : <Loader2 className="size-4 animate-spin text-primary" />}
                              <span className="font-medium capitalize">{lost ? 'Unavailable' : job.status}</span>
                              <span className="font-mono text-muted-foreground">{job.chunks_done}/{job.chunks_total ?? '?' } chunks</span>
                              <span className="ml-auto text-muted-foreground">attempt {job.attempts}</span>
                            </div>
                            {!lost && (job.status === 'running' || total > 0) && (
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
                            )}
                            {job.error && <p className="mt-2 text-destructive">{job.error}</p>}
                            {lost && (
                              <p className="mt-2 text-muted-foreground">
                                Progress is no longer available ({lost}). Refresh to see where the
                                document ended up.
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {loading ? (
                      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading documents…</div>
                    ) : documents.length === 0 ? (
                      <p className="py-4 text-sm text-muted-foreground">No documents in this department yet.</p>
                    ) : documents.map((document) => (
                      <div key={document.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                        {document.status === 'archived' ? <Archive className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-primary" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{document.title}</div>
                          <div className="text-xs text-muted-foreground">{document.file_name ?? 'Typed text'} · {document.file_type} · {document.chunk_count} chunks</div>
                        </div>
                        <Badge variant={statusVariant(document.status)} className={cn('capitalize', document.status === 'failed' && 'text-destructive')}>{document.status}</Badge>
                        {canCurate && document.status !== 'archived' && (
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => void archiveDocument(document)} disabled={busy === document.id} aria-label={`Archive ${document.title}`}>
                            {busy === document.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {/* Owner-only, and the gateway agrees: the members routes are
                    owner-or-admin, so a viewer or editor is not offered them. */}
                {canManageMembers && (
                  <section className="rounded-xl border bg-card p-4">
                    <div className="mb-4 flex items-center gap-2"><Users className="size-4 text-primary" /><h2 className="font-semibold">Member access</h2></div>
                    <div className="mb-4 space-y-2">
                      <div className="flex gap-2">
                        {/* Enter parks the typed address in the batch; the grant
                            itself is the separate button below. */}
                        <form onSubmit={queueTypedRecipient} className="min-w-0 flex-1">
                          <Label htmlFor="grant-email" className="sr-only">Email</Label>
                          <Input
                            id="grant-email"
                            type="email"
                            value={grantEmail}
                            onChange={(event) => setGrantEmail(event.target.value)}
                            placeholder="colleague@company.com"
                          />
                        </form>
                        {/* Only a global admin may read `GET /users`, so only they
                            get the directory picker; an owner types addresses. */}
                        {isAdmin && (
                          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" className="shrink-0">
                                <UserPlus className="size-4" /> Add from directory
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-0">
                              <div className="border-b p-2">
                                <Label htmlFor="grant-picker-search" className="sr-only">Search users</Label>
                                <div className="relative">
                                  <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    id="grant-picker-search"
                                    value={pickerQuery}
                                    onChange={(event) => setPickerQuery(event.target.value)}
                                    placeholder="Search users…"
                                    className="pl-8"
                                  />
                                </div>
                              </div>
                              <div className="max-h-64 overflow-y-auto p-1">
                                {pickerCandidates.length === 0 ? (
                                  <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                                    {availableUsers.length === 0 ? 'Everyone is already a member.' : 'No matches.'}
                                  </p>
                                ) : (
                                  pickerCandidates.map((user) => {
                                    const chosen = recipients.includes(user.email)
                                    return (
                                      <button
                                        key={user.id}
                                        type="button"
                                        aria-pressed={chosen}
                                        onClick={() => toggleRecipient(user.email)}
                                        className={cn(
                                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                                          chosen && 'bg-accent',
                                        )}
                                      >
                                        <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', chosen && 'border-primary bg-primary text-primary-foreground')}>
                                          {chosen && <CheckCircle2 className="size-3" />}
                                        </span>
                                        <span className="min-w-0 truncate">{user.email}</span>
                                      </button>
                                    )
                                  })
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>

                      {recipients.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {recipients.map((email) => (
                            <span key={email} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
                              <span className="max-w-[16rem] truncate">{email}</span>
                              <button
                                type="button"
                                onClick={() => removeRecipient(email)}
                                aria-label={`Remove ${email}`}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <div className="w-[150px]">
                          <Label htmlFor="grant-level" className="sr-only">Level</Label>
                          <select
                            id="grant-level"
                            value={grantLevel}
                            onChange={(event) =>
                              setGrantLevel(event.target.value as DepartmentRole | '')
                            }
                            className={SELECT_CLASS}
                          >
                            <option value="">Unchanged</option>
                            {DEPARTMENT_LEVELS.map((level) => (
                              <option key={level} value={level}>{levelLabel(level)}</option>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="button"
                          onClick={() => void grantMembers()}
                          disabled={pendingGrants === 0 || busy === 'grant'}
                        >
                          {busy === 'grant' && <Loader2 className="animate-spin" />}
                          {pendingGrants > 1 ? `Grant ${pendingGrants}` : 'Grant'}
                        </Button>
                      </div>
                    </div>
                    <p className="mb-4 text-xs text-muted-foreground">
                      Add one or more people, then grant them all at once. Granting an address
                      that is already a member changes their level. With the level left{' '}
                      <strong>Unchanged</strong>, a new member starts as Viewer and an existing
                      member keeps the level they have.
                    </p>
                    {members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No members have access yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {members.map((member) => (
                          <div key={member.user_id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm">{member.email}</span>
                            <select
                              aria-label={`Level for ${member.email}`}
                              value={member.role}
                              onChange={(event) =>
                                void changeMemberLevel(member, event.target.value as DepartmentRole)
                              }
                              disabled={busy === `member-${member.user_id}`}
                              className={cn(SELECT_CLASS, 'w-28')}
                            >
                              {DEPARTMENT_LEVELS.map((level) => (
                                <option key={level} value={level}>{levelLabel(level)}</option>
                              ))}
                            </select>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => void revokeMember(member)} disabled={busy === `member-${member.user_id}`}>
                              Revoke
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </main>
            )
          ) : (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
              {isAdmin ? 'Select or create a department.' : 'Select a department.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

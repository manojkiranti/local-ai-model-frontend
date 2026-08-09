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
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  type IngestAccepted,
  type IngestJob,
  type UserOut,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { documentTitleFromFilename } from '@/lib/rag-document'

const DOCUMENT_ACCEPT = '.pdf,.docx,.xlsx,.csv'

function ragError(error: unknown): string {
  return error instanceof GatewayError ? error.message : describeError(error)
}

function statusVariant(status: string): 'default' | 'outline' {
  if (status === 'ready' || status === 'succeeded') return 'default'
  return 'outline'
}

interface AdminRagPageProps {
  departments: Department[]
  onDepartmentsChanged: () => Promise<void>
}

/** Admin console for departments, corpus ingestion, and access grants. */
export function AdminRagPage({ departments, onDepartmentsChanged }: AdminRagPageProps) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DepartmentDocument[]>([])
  const [members, setMembers] = useState<DepartmentMember[]>([])
  const [users, setUsers] = useState<UserOut[]>([])
  const [jobs, setJobs] = useState<Record<string, IngestJob>>({})
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
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
  const [grantUserId, setGrantUserId] = useState('')

  const effectiveSelectedCode =
    selectedCode && departments.some((department) => department.code === selectedCode)
      ? selectedCode
      : departments[0]?.code ?? null
  const selected =
    departments.find((department) => department.code === effectiveSelectedCode) ?? null

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the selected server record into the edit field
    setEditName(selected?.name ?? '')
  }, [selected])

  const loadDepartment = useCallback(async () => {
    if (!effectiveSelectedCode) return
    setLoading(true)
    setNotice(null)
    try {
      const [nextDocuments, nextMembers, userPage] = await Promise.all([
        selected?.is_active
          ? listDepartmentDocuments(effectiveSelectedCode, includeArchived)
          : Promise.resolve([]),
        listDepartmentMembers(effectiveSelectedCode),
        listUsers(),
      ])
      setDocuments(nextDocuments)
      setMembers(nextMembers)
      setUsers(userPage.items)
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setLoading(false)
    }
  }, [effectiveSelectedCode, includeArchived, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per-department polling state before loading the next corpus
    setJobs({})
    void loadDepartment()
  }, [loadDepartment])

  const activeJobs = useMemo(
    () => Object.values(jobs).filter((job) => job.status === 'queued' || job.status === 'running'),
    [jobs],
  )

  useEffect(() => {
    if (!activeJobs.length) return
    const timer = window.setTimeout(() => {
      void Promise.all(
        activeJobs.map(async (job) => {
          try {
            return await getIngestJob(job.id)
          } catch (error) {
            setNotice(ragError(error))
            return job
          }
        }),
      ).then((updates) => {
        setJobs((current) => {
          const next = { ...current }
          for (const job of updates) next[job.id] = job
          return next
        })
        if (updates.some((job) => job.status === 'succeeded' || job.status === 'failed')) {
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
    setNotice(null)
    try {
      const created = await createDepartment({ code, name })
      await onDepartmentsChanged()
      setSelectedCode(created.code)
      setNewCode('')
      setNewName('')
      setNotice(`Created ${created.name}`)
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function saveDepartment() {
    if (!selected) return
    setBusy('save-department')
    setNotice(null)
    try {
      await updateDepartment(selected.code, { name: editName.trim() })
      await onDepartmentsChanged()
      setNotice('Department updated')
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function toggleDepartment() {
    if (!selected) return
    setBusy('toggle-department')
    setNotice(null)
    try {
      await updateDepartment(selected.code, { is_active: !selected.is_active })
      await onDepartmentsChanged()
      setNotice(selected.is_active ? 'Department disabled' : 'Department enabled')
    } catch (error) {
      setNotice(ragError(error))
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
    setNotice(null)
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
      setNotice('Document queued for ingestion')
      await loadDepartment()
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function submitText(event: FormEvent) {
    event.preventDefault()
    if (!selected || !textTitle.trim() || !textContent.trim()) return
    setBusy('text')
    setNotice(null)
    try {
      const accepted = await createDepartmentTextDocument(selected.code, {
        title: textTitle.trim(),
        content: textContent.trim(),
      })
      queueAccepted(accepted)
      setTextTitle('')
      setTextContent('')
      setNotice('Text queued for ingestion')
      await loadDepartment()
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function archiveDocument(document: DepartmentDocument) {
    if (!selected || !window.confirm(`Archive “${document.title}”?`)) return
    setBusy(document.id)
    setNotice(null)
    try {
      await archiveDepartmentDocument(selected.code, document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setNotice('Document archived')
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function grantMember(event: FormEvent) {
    event.preventDefault()
    if (!selected || !grantUserId) return
    setBusy('grant')
    setNotice(null)
    try {
      await grantDepartmentMember(selected.code, Number(grantUserId))
      setGrantUserId('')
      await loadDepartment()
      setNotice('Access granted')
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  async function revokeMember(userId: number) {
    if (!selected) return
    setBusy(`member-${userId}`)
    setNotice(null)
    try {
      await revokeDepartmentMember(selected.code, userId)
      setMembers((current) => current.filter((member) => member.user_id !== userId))
      setNotice('Access revoked')
    } catch (error) {
      setNotice(ragError(error))
    } finally {
      setBusy(null)
    }
  }

  const memberIds = new Set(members.map((member) => member.user_id))
  const availableUsers = users.filter((user) => !memberIds.has(user.id) && user.is_active)

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
          <div className="mb-4 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-primary" />
            {notice}
          </div>
        )}

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
            {!departments.length && <p className="px-2 py-4 text-xs text-muted-foreground">Create the first department above.</p>}
          </aside>

          {selected ? (
            <main className="space-y-5">
              <section className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-semibold">{selected.name}</h2>
                  <Badge variant="outline" className="font-mono">{selected.code}</Badge>
                  <Badge variant={selected.is_active ? 'default' : 'outline'} className={!selected.is_active ? 'text-destructive' : undefined}>{selected.is_active ? 'Active' : 'Disabled'}</Badge>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={128} />
                  <Button variant="outline" onClick={() => void saveDepartment()} disabled={!editName.trim() || busy === 'save-department'}>Save name</Button>
                  <Button variant={selected.is_active ? 'destructive' : 'default'} onClick={() => void toggleDepartment()} disabled={busy === 'toggle-department'}>
                    {selected.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </section>

              <section className="rounded-xl border bg-card p-4">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <h2 className="font-semibold">Documents</h2>
                  <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
                    Include archived
                  </label>
                </div>

                {!selected.is_active && (
                  <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Enable this department before managing its corpus.</p>
                )}

                <div className="grid gap-4 xl:grid-cols-2">
                  <form onSubmit={submitUpload} className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold"><Upload className="size-4" /> Upload file</div>
                    <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Document title" required disabled={!selected.is_active} />
                    <Input
                      key={uploadInputKey}
                      type="file"
                      accept={DOCUMENT_ACCEPT}
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
                    <Input value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="Document title" required disabled={!selected.is_active} />
                    <Textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} placeholder="Knowledge content" className="min-h-24" required disabled={!selected.is_active} />
                    <Button type="submit" size="sm" disabled={!selected.is_active || busy === 'text'}>
                      {busy === 'text' ? <Loader2 className="animate-spin" /> : <Plus />} Queue text
                    </Button>
                  </form>
                </div>

                {Object.values(jobs).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {Object.values(jobs).map((job) => {
                      const total = job.chunks_total ?? 0
                      const percent = total > 0 ? Math.min(100, Math.round((job.chunks_done / total) * 100)) : 0
                      return (
                        <div key={job.id} className="rounded-lg border px-3 py-2 text-xs">
                          <div className="flex items-center gap-2">
                            {job.status === 'succeeded' ? <CheckCircle2 className="size-4 text-green-600" /> : job.status === 'failed' ? <XCircle className="size-4 text-destructive" /> : <Loader2 className="size-4 animate-spin text-primary" />}
                            <span className="font-medium capitalize">{job.status}</span>
                            <span className="font-mono text-muted-foreground">{job.chunks_done}/{job.chunks_total ?? '?' } chunks</span>
                            <span className="ml-auto text-muted-foreground">attempt {job.attempts}</span>
                          </div>
                          {(job.status === 'running' || total > 0) && (
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
                          )}
                          {job.error && <p className="mt-2 text-destructive">{job.error}</p>}
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
                      {document.status !== 'archived' && (
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => void archiveDocument(document)} disabled={busy === document.id} aria-label={`Archive ${document.title}`}>
                          {busy === document.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border bg-card p-4">
                <div className="mb-4 flex items-center gap-2"><Users className="size-4 text-primary" /><h2 className="font-semibold">Member access</h2></div>
                <form onSubmit={grantMember} className="mb-4 flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="grant-user" className="sr-only">User</Label>
                    <select id="grant-user" value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" required>
                      <option value="">Select a user…</option>
                      {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.email} ({user.role})</option>)}
                    </select>
                  </div>
                  <Button type="submit" disabled={!grantUserId || busy === 'grant'}>{busy === 'grant' && <Loader2 className="animate-spin" />} Grant</Button>
                </form>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members have access yet.</p>
                ) : (
                  <div className="space-y-2">
                    {members.map((member) => {
                      const user = users.find((candidate) => candidate.id === member.user_id)
                      return (
                        <div key={member.user_id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{user?.email ?? `User #${member.user_id}`}</span>
                          {user && <Badge variant="outline" className="capitalize">{user.role}</Badge>}
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => void revokeMember(member.user_id)} disabled={busy === `member-${member.user_id}`}>
                            Revoke
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </main>
          ) : (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Select or create a department.</div>
          )}
        </div>
      </div>
    </div>
  )
}

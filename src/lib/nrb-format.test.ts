import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCOPE_FORM,
  buildTriggerRequest,
  formatCountValue,
  hasBound,
  humanizeKey,
  parseLimit,
  parseList,
  parseYears,
  scopeFormIssue,
  splitBlock,
  statusLabel,
  statusNote,
} from '@/lib/nrb-format'

describe('statusLabel', () => {
  it('uses the operational wording for every pipeline status', () => {
    expect(statusLabel('queued')).toBe('Queued')
    expect(statusLabel('running')).toBe('Updating')
    expect(statusLabel('awaiting_jobs')).toBe('Indexing')
    expect(statusLabel('succeeded')).toBe('Succeeded')
    expect(statusLabel('partial')).toBe('Completed with failures')
    expect(statusLabel('failed')).toBe('Failed')
  })

  it('falls back to the raw status the gateway sent', () => {
    // A new backend status must show as itself, never as a wrong known label.
    expect(statusLabel('cancelled')).toBe('cancelled')
  })
})

describe('statusNote', () => {
  it('explains queued as waiting for the runner and claims nothing more', () => {
    expect(statusNote('queued')).toBe(
      'Waiting for the NRB pipeline runner to claim it',
    )
  })

  it('distinguishes running (pipeline runner) from awaiting_jobs (RAG worker)', () => {
    expect(statusNote('running')).toBe('The NRB pipeline runner is staging files')
    expect(statusNote('awaiting_jobs')).toBe(
      'Staging finished; the RAG worker is still indexing',
    )
  })

  it('has no note for terminal statuses', () => {
    expect(statusNote('succeeded')).toBeNull()
    expect(statusNote('partial')).toBeNull()
    expect(statusNote('failed')).toBeNull()
  })
})

describe('formatCountValue', () => {
  it('formats a bytes key as a size, not as a count', () => {
    expect(formatCountValue('bytes_on_disk', 5_242_880)).toBe('5 MB')
  })

  it('groups plain counts with thousands separators', () => {
    expect(formatCountValue('files', 18266)).toBe('18,266')
    expect(formatCountValue('files', 0)).toBe('0')
  })

  it('renders a non-numeric value as text rather than dropping it', () => {
    expect(formatCountValue('note', 'skipped')).toBe('skipped')
    expect(formatCountValue('missing', null)).toBe('—')
  })
})

describe('humanizeKey', () => {
  it('turns a snake_case counter key into a label', () => {
    expect(humanizeKey('active_sources')).toBe('Active sources')
    expect(humanizeKey('duplicate_comparison_keys')).toBe('Duplicate comparison keys')
    expect(humanizeKey('rag')).toBe('Rag')
  })
})

describe('splitBlock', () => {
  it('keeps scalars as entries in the order the gateway sent them', () => {
    const block = splitBlock({ pending: 3, fetched: 10, failed: 1 })
    expect(block.groups).toEqual([])
    expect(block.entries.map((entry) => entry.key)).toEqual([
      'pending',
      'fetched',
      'failed',
    ])
    expect(block.entries[1]).toEqual({ key: 'fetched', label: 'Fetched', value: '10' })
  })

  it('renders nested maps as their own labelled groups instead of flattening', () => {
    const block = splitBlock({
      ready: 4,
      documents: { ready: 4, failed: 2 },
      jobs: { succeeded: 6 },
    })
    expect(block.entries.map((entry) => entry.key)).toEqual(['ready'])
    expect(block.groups.map((group) => group.key)).toEqual(['documents', 'jobs'])
    expect(block.groups[0].label).toBe('Documents')
    expect(block.groups[0].entries).toEqual([
      { key: 'ready', label: 'Ready', value: '4' },
      { key: 'failed', label: 'Failed', value: '2' },
    ])
  })

  it('includes counter keys it has never seen before', () => {
    // A stage may add a counter without a schema change.
    const block = splitBlock({ brand_new_counter: 7 })
    expect(block.entries).toEqual([
      { key: 'brand_new_counter', label: 'Brand new counter', value: '7' },
    ])
  })

  it('is empty for an empty block', () => {
    expect(splitBlock({})).toEqual({ entries: [], groups: [] })
  })
})

describe('parseList', () => {
  it('splits on commas and newlines and drops blanks', () => {
    expect(parseList(' banking , , forex\nmonetary ')).toEqual([
      'banking',
      'forex',
      'monetary',
    ])
  })

  it('is empty for whitespace only', () => {
    expect(parseList('   ')).toEqual([])
  })
})

describe('parseYears', () => {
  it('keeps integer years and drops anything that is not one', () => {
    expect(parseYears('2024, 2025, abc, ')).toEqual([2024, 2025])
  })
})

describe('parseLimit', () => {
  it('accepts an integer inside the gateway range', () => {
    expect(parseLimit('50')).toBe(50)
  })

  it('rejects non-numbers, zero and values above the gateway maximum', () => {
    expect(parseLimit('abc')).toBeUndefined()
    expect(parseLimit('0')).toBeUndefined()
    expect(parseLimit('5001')).toBeUndefined()
    expect(parseLimit('')).toBeUndefined()
  })
})

describe('hasBound', () => {
  it('is false for an untouched form', () => {
    expect(hasBound(EMPTY_SCOPE_FORM)).toBe(false)
  })

  it('is false when the only bound typed is not a usable value', () => {
    expect(hasBound({ ...EMPTY_SCOPE_FORM, limit: 'abc' })).toBe(false)
    expect(hasBound({ ...EMPTY_SCOPE_FORM, years: 'soon' })).toBe(false)
  })

  it('is true once any single bound is set', () => {
    expect(hasBound({ ...EMPTY_SCOPE_FORM, limit: '25' })).toBe(true)
    expect(hasBound({ ...EMPTY_SCOPE_FORM, years: '2025' })).toBe(true)
    expect(hasBound({ ...EMPTY_SCOPE_FORM, sections: 'banking' })).toBe(true)
    expect(hasBound({ ...EMPTY_SCOPE_FORM, owners: 'nrb' })).toBe(true)
    expect(hasBound({ ...EMPTY_SCOPE_FORM, extensions: 'pdf' })).toBe(true)
  })

  it('does not treat the department as a bound', () => {
    expect(hasBound({ ...EMPTY_SCOPE_FORM, department: 'research' })).toBe(false)
  })
})

describe('scopeFormIssue', () => {
  it('asks for a department first, because the rag stage needs one', () => {
    expect(scopeFormIssue({ ...EMPTY_SCOPE_FORM, limit: '25' })).toBe(
      'Choose a department — the rag stage ingests into it.',
    )
  })

  it('asks for a bound, because the gateway rejects an unbounded request', () => {
    expect(scopeFormIssue({ ...EMPTY_SCOPE_FORM, department: 'research' })).toBe(
      'Set at least one bound: limit, years, sections, owners or extensions.',
    )
  })

  it('is null once a department and one bound are set', () => {
    expect(
      scopeFormIssue({ ...EMPTY_SCOPE_FORM, department: 'research', limit: '25' }),
    ).toBeNull()
  })
})

describe('buildTriggerRequest', () => {
  const form = {
    department: ' research ',
    limit: '25',
    years: '2025',
    sections: 'banking, forex',
    owners: '',
    extensions: 'pdf',
  }

  it('sends the four staging stages and retry_failed:false for an update', () => {
    expect(buildTriggerRequest(form, 'update')).toEqual({
      department: 'research',
      stages: ['sync', 'fetch', 'extract', 'rag'],
      retry_failed: false,
      limit: 25,
      years: [2025],
      sections: ['banking', 'forex'],
      extensions: ['pdf'],
    })
  })

  it('sends only the rag stage with retry_failed:true for a retry', () => {
    const body = buildTriggerRequest(form, 'retry')
    expect(body.stages).toEqual(['rag'])
    expect(body.retry_failed).toBe(true)
    expect(body.department).toBe('research')
    expect(body.limit).toBe(25)
  })

  it('omits bounds the operator left blank rather than sending empty ones', () => {
    const body = buildTriggerRequest(
      { ...EMPTY_SCOPE_FORM, department: 'research', limit: '10' },
      'update',
    )
    expect(body).toEqual({
      department: 'research',
      stages: ['sync', 'fetch', 'extract', 'rag'],
      retry_failed: false,
      limit: 10,
    })
    expect(body).not.toHaveProperty('years')
    expect(body).not.toHaveProperty('sections')
  })

  it('never expresses a full-corpus run', () => {
    // `all_files` is absent from the request type; assert it is absent from the
    // wire body too, for either action.
    for (const kind of ['update', 'retry'] as const) {
      const body = buildTriggerRequest(form, kind)
      expect(Object.keys(body)).not.toContain('all_files')
      expect(JSON.stringify(body)).not.toContain('all_files')
    }
  })
})

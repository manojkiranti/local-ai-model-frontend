import { useState } from 'react'
import { AlertTriangle, Binary, Loader2 } from 'lucide-react'
import { cosineSimilarity, describeError, getEmbeddings } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface EmbeddingResult {
  model: string
  vectors: number[][]
}

interface EmbeddingsPanelProps {
  reachable: boolean
  embedModel?: string
}

function previewVector(vec: number[], count = 8): string {
  const head = vec
    .slice(0, count)
    .map((v) => v.toFixed(4))
    .join(', ')
  return vec.length > count ? `[${head}, …]` : `[${head}]`
}

function similarityLabel(sim: number): string {
  if (sim >= 0.9) return 'Nearly identical'
  if (sim >= 0.7) return 'Very similar'
  if (sim >= 0.4) return 'Related'
  if (sim >= 0.15) return 'Loosely related'
  return 'Unrelated'
}

function VectorCard({ label, vector }: { label: string; vector: number[] }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </span>
        <Badge variant="outline">
          <span className="font-mono">{vector.length}</span> dims
        </Badge>
      </div>
      <code className="block overflow-x-auto whitespace-nowrap rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
        {previewVector(vector)}
      </code>
    </div>
  )
}

export function EmbeddingsPanel({ reachable, embedModel }: EmbeddingsPanelProps) {
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EmbeddingResult | null>(null)

  const run = async () => {
    const a = textA.trim()
    const b = textB.trim()
    if (!a) return
    const inputs = b ? [a, b] : [a]
    setLoading(true)
    setError(null)
    try {
      const res = await getEmbeddings(inputs)
      setResult({ model: res.model, vectors: res.embeddings })
    } catch (e) {
      setError(describeError(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const canRun = reachable && textA.trim().length > 0 && !loading
  const sim =
    result && result.vectors.length === 2
      ? cosineSimilarity(result.vectors[0], result.vectors[1])
      : null
  // Map cosine range [-1, 1] to a 0–100% bar.
  const simPct = sim === null || Number.isNaN(sim) ? 0 : ((sim + 1) / 2) * 100

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] space-y-6 px-6 py-10">
        <header className="space-y-2">
          <h1 className="text-[26px] font-semibold tracking-tight">
            Embeddings playground
          </h1>
          <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
            Encode one or two passages with a local embedding model and compare
            them. Vectors never leave the machine.
            {embedModel && (
              <>
                {' '}
                Model:{' '}
                <span className="font-mono text-foreground/70">{embedModel}</span>
              </>
            )}
          </p>
        </header>

        {!reachable && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Gateway or Ollama is unreachable.</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="text-a">Text A</Label>
            <Textarea
              id="text-a"
              rows={4}
              value={textA}
              disabled={!reachable}
              onChange={(e) => setTextA(e.target.value)}
              placeholder="The quick brown fox."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="text-b">
              Text B <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="text-b"
              rows={4}
              value={textB}
              disabled={!reachable}
              onChange={(e) => setTextB(e.target.value)}
              placeholder="A fast auburn canine."
            />
          </div>
        </div>

        <Button onClick={run} disabled={!canRun} className="rounded-xl">
          {loading ? <Loader2 className="animate-spin" /> : <Binary />}
          {loading ? 'Computing…' : 'Compute vectors'}
        </Button>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {sim !== null && !Number.isNaN(sim) && (
              <div className="rounded-2xl border border-primary/20 bg-primary/8 p-5">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <span className="text-sm font-semibold">Cosine similarity</span>
                  <span className="font-mono text-xl text-primary">
                    {sim.toFixed(4)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full bg-primary transition-all')}
                    style={{ width: `${simPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {similarityLabel(sim)} · scale −1 to 1
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {result.vectors[0] && (
                <VectorCard label="Text A" vector={result.vectors[0]} />
              )}
              {result.vectors[1] && (
                <VectorCard label="Text B" vector={result.vectors[1]} />
              )}
            </div>

            <p className="font-mono text-[10px] text-muted-foreground">
              model · {result.model}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

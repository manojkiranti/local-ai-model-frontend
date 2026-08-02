import { SlidersHorizontal } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import type { GenerationConfig } from '@/lib/chat-config'

interface GenerationSettingsProps {
  value: GenerationConfig
  onChange: (value: GenerationConfig) => void
}

export function GenerationSettings({ value, onChange }: GenerationSettingsProps) {
  const set = (patch: Partial<GenerationConfig>) => onChange({ ...value, ...patch })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-lg bg-card font-semibold text-foreground/70 hover:border-primary hover:text-primary"
        >
          <SlidersHorizontal />
          Generation
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 rounded-2xl">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="temperature">Temperature</Label>
            <span className="font-mono text-xs text-muted-foreground">
              {value.temperature.toFixed(2)}
            </span>
          </div>
          <Slider
            id="temperature"
            value={[value.temperature]}
            min={0}
            max={2}
            step={0.05}
            onValueChange={([t]) => set({ temperature: t })}
          />
          <p className="text-xs text-muted-foreground">
            Lower is more focused, higher is more creative.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="num-ctx">Context window (num_ctx)</Label>
          <Input
            id="num-ctx"
            type="number"
            min={0}
            step={512}
            value={value.numCtx}
            onChange={(e) => set({ numCtx: Number(e.target.value) || 0 })}
            className="font-mono"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Applies to plain Chat turns. Agent (Tools) turns use the server defaults.
        </p>
      </PopoverContent>
    </Popover>
  )
}

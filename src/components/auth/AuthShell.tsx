import type { ReactNode } from 'react'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME, APP_NAME_PRIMARY, APP_NAME_SECONDARY, APP_TAGLINE } from '@/lib/branding'

export function AuthShell({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-80 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,var(--color-primary)_0%,transparent_70%)] opacity-[0.08]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
            <BurstLogo size={40} title={APP_NAME} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-primary">{APP_NAME_PRIMARY}</p>
            <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground">
              {APP_NAME_SECONDARY}
            </h1>
            <p className="mx-auto mt-2 w-fit max-w-full truncate rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-tight text-primary">
              {APP_TAGLINE}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-lg shadow-black/[0.03]">
          <h2 className="mb-5 text-base font-semibold tracking-tight">{title}</h2>
          {children}
        </div>
        <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  )
}

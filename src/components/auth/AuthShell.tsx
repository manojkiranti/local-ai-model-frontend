import type { ReactNode } from 'react'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME } from '@/lib/branding'

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="grid min-h-full place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BurstLogo size={44} title={APP_NAME} />
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">{children}</div>
        <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  )
}

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UserOut } from '@/lib/api'

interface UserActiveToggleProps {
  user: UserOut
  /** The signed-in admin's own row. */
  isSelf: boolean
  busy: boolean
  onChange: (isActive: boolean) => void
}

/**
 * Offboard or restore an account. Shared by the directory and the detail page so
 * the one refusal the client can be certain of — self-deactivation — is decided
 * in a single place. The last-active-admin case is a 409 from the gateway and is
 * rendered by the caller, verbatim.
 */
export function UserActiveToggle({ user, isSelf, busy, onChange }: UserActiveToggleProps) {
  if (!user.is_active) {
    return (
      <Button variant="outline" size="sm" onClick={() => onChange(true)} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null} Activate
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive"
      onClick={() => onChange(false)}
      disabled={busy || isSelf}
      title={isSelf ? 'You cannot deactivate your own account' : undefined}
    >
      {busy ? <Loader2 className="animate-spin" /> : null} Deactivate
    </Button>
  )
}

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { emailError, passwordError } from '@/lib/auth-validation'
import { APP_NAME, APP_TAGLINE } from '@/lib/branding'
import { describeError } from '@/lib/api'
import { AuthShell } from './AuthShell'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = {
      email: emailError(email) ?? undefined,
      password: passwordError(password) ?? undefined,
    }
    setFieldErrors(errs)
    if (errs.email || errs.password) return

    setPending(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle={`${APP_NAME} — ${APP_TAGLINE}`}
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          {fieldErrors.email && (
            <p className="text-xs text-destructive">{fieldErrors.email}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
          />
          {fieldErrors.password && (
            <p className="text-xs text-destructive">{fieldErrors.password}</p>
          )}
        </div>

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" disabled={pending} className="mt-1">
          {pending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthShell>
  )
}

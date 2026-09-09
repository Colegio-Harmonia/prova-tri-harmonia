'use client'

import { Suspense, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import {
  loginCredentialsSchema,
  type LoginCredentials,
} from '@/features/auth/schemas/login-credentials'

// Auth.js redireciona de volta pra /login?error=... quando o `signIn`
// callback recusa a conta Google (domínio errado ou e-mail sem cadastro
// prévio em `users` — não há autocadastro, ver src/auth/auth.ts).
const GOOGLE_ERROR_MESSAGE = 'Esse e-mail Google não tem acesso liberado. Fale com a coordenação para criar sua conta.'

function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const [error, setError] = useState<string | null>(searchParams.get('error') ? GOOGLE_ERROR_MESSAGE : null)
  const [googleLoading, setGoogleLoading] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginCredentials>({
    resolver: zodResolver(loginCredentialsSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function submitCredentials(credentials: LoginCredentials) {
    setError(null)

    const result = await signIn('credentials', {
      email: credentials.email,
      password: credentials.password,
      redirect: false,
    })

    if (result?.error) {
      setError('Email ou senha incorretos.')
      return
    }

    window.location.href = callbackUrl
  }

  return (
    <form
      onSubmit={handleSubmit(submitCredentials)}
      className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-8 shadow-soft"
      noValidate
    >
      <div className="flex items-center gap-3">
        <Image src="/brand/harmonia-icon.png" alt="" width={48} height={48} priority className="h-12 w-12 shrink-0 object-contain" />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-content-primary">Prova-TRI</h1>
          <p className="text-sm text-content-muted">Colégio Harmonia - acesso restrito</p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-content-primary" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          aria-describedby={errors.email ? 'email-error' : undefined}
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email')}
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary"
        />
        {errors.email && (
          <p id="email-error" role="alert" className="text-sm text-status-danger">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-content-primary" htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          aria-describedby={errors.password ? 'password-error' : undefined}
          aria-invalid={errors.password ? 'true' : 'false'}
          {...register('password')}
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary"
        />
        {errors.password && (
          <p id="password-error" role="alert" className="text-sm text-status-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-status-danger">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded bg-harmonia-green px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-action-primary-hover disabled:opacity-60"
      >
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </button>

      <div className="flex items-center gap-3 text-xs text-content-muted">
        <div className="h-px flex-1 bg-border" />
        ou
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        disabled={googleLoading}
        onClick={() => {
          setGoogleLoading(true)
          signIn('google', { callbackUrl })
        }}
        className="flex w-full items-center justify-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        {googleLoading ? 'Redirecionando…' : 'Entrar com Google (e-mail institucional)'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}

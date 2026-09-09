import type { NextAuthConfig } from 'next-auth'

// ⚠️ Lista IRMÃ do matcher em src/middleware.ts — o matcher decide onde o
// middleware RODA (precisa ser array literal estático, o Next não aceita
// valor computado), e esta lista decide o que EXIGE login. Rota nova
// protegida precisa entrar NAS DUAS, senão passa anônima (aconteceu com
// /reforco no deploy DEV de 24/07/2026 — descoberto na validação).
const PROTECTED_PATHS = [
  '/dashboard',
  '/gerar',
  '/reforco',
  '/status',
  '/atividades',
  '/turmas',
  '/usuarios',
  '/desempenho',
  '/api/exams',
  '/api/curriculum',
  '/api/users',
  '/api/stats',
  '/api/classroom',
  '/api/analytics',
  '/api/generation-jobs',
  '/api/reinforcement',
  '/api/activities',
]

// Edge-safe config: no Credentials provider (needs bcrypt + Postgres, both
// Node-only) — those live in auth.ts, used only by the API route handler and
// server components. Middleware imports only this file.
export const authConfig = {
  // Served directly on the LAN by IP (no reverse proxy setting forwarded
  // host headers) — Auth.js v5 refuses unrecognized hosts unless told to
  // trust this deployment.
  trustHost: true,
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isProtected = PROTECTED_PATHS.some((path) => nextUrl.pathname.startsWith(path))
      if (isProtected) return isLoggedIn
      return true
    },
    jwt: ({ token, user }) => {
      if (user) token.role = (user as { role: string }).role
      return token
    },
    session: ({ session, token }) => {
      if (session.user) session.user.role = token.role as string
      return session
    },
  },
} satisfies NextAuthConfig

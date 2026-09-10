import NextAuth, { customFetch } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { authConfig } from './auth.config'
import { googleOAuthFetchWithRetry } from './google-oauth-fetch'

// Domínio institucional — único domínio aceito no login Google. Verificado
// de novo no `signIn` callback (o parâmetro `hd` do Google é só uma dica de
// UI, não uma garantia de segurança por si só).
const INSTITUTIONAL_DOMAIN = 'colegioharmonia.com.br'

// classroom.courses.readonly (Subtarefa 2) + classroom.rosters.readonly
// (Subtarefa 4) + classroom.coursework.students (Subtarefa 5, 17/07/2026 —
// criar atividade e lançar/devolver nota, escopo de ESCRITA, mais sensível
// que os anteriores). access_type=offline + prompt=consent garantem que o
// Google sempre devolve refresh_token, senão só vem na primeira
// autorização e a gente perde o acesso quando o access token (~1h) expira
// no meio de uma sessão. Lembrete (já custou um teste real): token
// renovado via refresh_token NUNCA ganha escopo novo — precisa logout +
// login de verdade depois de qualquer mudança aqui, ver CLAUDE.md.
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  // O roster traz nomes, mas o Google só preenche `profile.photoUrl` com
  // este escopo explícito. É necessário reconectar uma vez depois do deploy.
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  // Cria o Formulário que recebe as respostas das Atividades FI/FII.
  // Permite compartilhar, somente com a professora responsável, o Form
  // que esta própria integração acabou de criar. Mudanças nesta lista
  // exigem reconexão da conta Google.
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

// `token` tipado `any` de propósito: a augmentation de next-auth/jwt (ver
// src/types/next-auth.d.ts) não resolve pro tipo real usado nesse callback
// nessa versão beta do Auth.js v5 — os campos existem em runtime (ver
// jwt callback abaixo), só a inferência estática que não casa.
async function refreshGoogleAccessToken(token: any) {
  try {
    const res = await googleOAuthFetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.googleRefreshToken ?? '',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw data

    return {
      ...token,
      googleAccessToken: data.access_token as string,
      googleAccessTokenExpires: Date.now() + data.expires_in * 1000,
      googleRefreshToken: (data.refresh_token as string | undefined) ?? token.googleRefreshToken,
      googleError: undefined,
    }
  } catch (err) {
    console.warn('[auth] falha ao renovar access token do Google:', err)
    return { ...token, googleError: 'RefreshAccessTokenError' as const }
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined
        const password = credentials?.password as string | undefined
        if (!email || !password) return null

        const user = await db.query.users.findFirst({ where: eq(users.email, email) })
        if (!user || !user.active || !user.passwordHash) return null

        const passwordMatches = await bcrypt.compare(password, user.passwordHash)
        if (!passwordMatches) return null

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
        }
      },
    }),
    Google({
      // Auth.js v5 não lê GOOGLE_CLIENT_ID/SECRET automaticamente (só a
      // convenção AUTH_GOOGLE_ID/SECRET) — precisa passar explícito.
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      [customFetch]: googleOAuthFetchWithRetry,
      authorization: {
        params: { hd: INSTITUTIONAL_DOMAIN, prompt: 'select_account consent', access_type: 'offline', scope: GOOGLE_SCOPES },
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Sem autocadastro: login Google só é aceito para um e-mail que já
    // existe como `coordenacao`/`professor` ativo em `users` — a conta
    // precisa ter sido criada antes via `scripts/create-user.ts`. Aluno
    // nunca passa por aqui (não tem linha em `users`, não faz login).
    signIn: async ({ user, account }) => {
      if (account?.provider !== 'google') return true
      const email = user.email
      if (!email || !email.toLowerCase().endsWith(`@${INSTITUTIONAL_DOMAIN}`)) return false

      const dbUser = await db.query.users.findFirst({ where: eq(users.email, email) })
      if (!dbUser || !dbUser.active) return false
      return true
    },
    jwt: async ({ token, user, account }) => {
      if (user) {
        if (account?.provider === 'google') {
          const dbUser = await db.query.users.findFirst({ where: eq(users.email, user.email!) })
          if (!dbUser) return token // bloqueado pelo signIn acima; defensivo

          token.sub = String(dbUser.id)
          token.role = dbUser.role
          await db
            .update(users)
            .set({
              lastLoginAt: new Date(),
              ...(dbUser.googleId !== account.providerAccountId ? { googleId: account.providerAccountId } : {}),
            })
            .where(eq(users.id, dbUser.id))

          token.googleAccessToken = account.access_token
          token.googleAccessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined
          token.googleScopes = account.scope
          if (account.refresh_token) token.googleRefreshToken = account.refresh_token
        } else {
          token.role = (user as { role: string }).role
        }
        return token
      }

      // Chamadas subsequentes (sessão já existente) — renova o access token
      // do Google ~1min antes de expirar, se tivermos refresh_token. Cast
      // explícito: a augmentation de next-auth/jwt não está resolvendo pro
      // tipo de `token` nesse callback (vira `unknown` sem o cast, mesmo
      // com o campo declarado em src/types/next-auth.d.ts).
      const googleToken = token as { googleAccessTokenExpires?: number; googleRefreshToken?: string }
      const expiresAt = googleToken.googleAccessTokenExpires
      if (typeof expiresAt === 'number' && googleToken.googleRefreshToken && Date.now() > expiresAt - 60_000) {
        return refreshGoogleAccessToken(token)
      }

      return token
    },
    session: ({ session, token }) => {
      const t = token as any
      if (session.user) session.user.role = t.role as string
      session.googleAccessToken = t.googleAccessToken
      session.googleScopes = t.googleScopes
      session.googleError = t.googleError
      return session
    },
  },
})

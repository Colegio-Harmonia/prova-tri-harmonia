import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      role: string
    } & DefaultSession['user']
    // Presentes só quando o login foi via Google com escopo do Classroom
    // concedido — login por senha nunca preenche isso (ver src/auth/auth.ts).
    googleAccessToken?: string
    googleScopes?: string
    googleError?: 'RefreshAccessTokenError'
  }

  interface User {
    role: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: string
    googleAccessToken?: string
    googleScopes?: string
    googleRefreshToken?: string
    googleAccessTokenExpires?: number
    googleError?: 'RefreshAccessTokenError'
  }
}

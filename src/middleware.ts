import NextAuth from 'next-auth'
import { authConfig } from '@/auth/auth.config'

export default NextAuth(authConfig).auth

// ⚠️ Lista IRMÃ de PROTECTED_PATHS em src/auth/auth.config.ts — rota nova
// protegida precisa entrar nas duas (ver comentário completo lá).
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/gerar/:path*',
    '/reforco/:path*',
    '/status/:path*',
    '/atividades/:path*',
    '/turmas/:path*',
    '/usuarios/:path*',
    '/desempenho/:path*',
    '/api/exams/:path*',
    '/api/curriculum/:path*',
    '/api/users/:path*',
    '/api/stats/:path*',
    '/api/classroom/:path*',
    '/api/analytics/:path*',
    '/api/generation-jobs/:path*',
    '/api/reinforcement/:path*',
    '/api/activities/:path*',
  ],
}

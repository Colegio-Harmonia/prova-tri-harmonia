import type { users } from '@/db/schema'

export type UserRole = (typeof users.$inferSelect)['role']

export const ROLE_LABELS: Record<UserRole, string> = {
  professor: 'Professor(a)',
  coordenacao: 'Coordenação',
  direcao: 'Direção',
}

// Coordenação e Direção têm visão de superusuário idêntica em todo o
// sistema (confirmado 17/07/2026) — um único helper pra não duplicar a
// checagem em cada rota, e pra Direção nunca ficar de fora de uma
// permissão só porque um call site novo esqueceu de incluir os dois
// valores.
export function isStaffSuperuser(role: string): boolean {
  return role === 'coordenacao' || role === 'direcao'
}

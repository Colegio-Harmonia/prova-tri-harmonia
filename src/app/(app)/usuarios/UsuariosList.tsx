'use client'

import { useEffect, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'

import { DataTable, type DataTableFeatures } from '@/components/ui/data-table'

type Role = 'professor' | 'coordenacao' | 'direcao'
type User = { id: number; name: string; email: string; role: Role; active: boolean; lastLoginAt: string | null; createdAt: string; chatConnectedAt: string | null }
type AuditEvent = { action: string; createdAt: string; targetUserId: number | null; actorName: string | null; targetUserName: string | null }

const ROLE_LABELS: Record<Role, string> = { professor: 'Professor(a)', coordenacao: 'Coordenação', direcao: 'Direção' }
const columnHelper = createColumnHelper<DataTableFeatures, User>()

export default function UsuariosList() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [audit, setAudit] = useState<AuditEvent[]>([])

  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('professor')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/users?all=1')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Erro ao carregar usuários.')
      setUsers(body.users)
      const auditResponse = await fetch('/api/admin/audit')
      if (auditResponse.ok) setAudit((await auditResponse.json()).events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function updateUser(id: number, patch: Partial<Pick<User, 'role' | 'active'>>) {
    setSavingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Erro ao salvar.')
      setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? { ...u, ...body.user } : u)))
      const auditResponse = await fetch('/api/admin/audit')
      if (auditResponse.ok) setAudit((await auditResponse.json()).events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSavingId(null)
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Erro ao cadastrar usuário.')
      setNewName('')
      setNewEmail('')
      setNewRole('professor')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar usuário.')
    } finally {
      setCreating(false)
    }
  }

  if (error && !users) return <p className="text-sm text-red-600">{error}</p>
  if (!users) return <p className="text-sm text-neutral-500">Carregando…</p>

  const activeCount = users.filter((user) => user.active).length
  const leadershipCount = users.filter((user) => user.role !== 'professor' && user.active).length
  const chatConnectedCount = users.filter((user) => user.chatConnectedAt).length
  const columns = columnHelper.columns([
    columnHelper.accessor('name', {
      header: 'Nome',
      enableSorting: true,
      cell: ({ row }) => <span className="font-medium text-content-primary">{row.original.name}</span>,
    }),
    columnHelper.accessor('email', { header: 'E-mail', enableSorting: true }),
    columnHelper.accessor('role', {
      header: 'Cargo',
      enableSorting: true,
      cell: ({ row }) => {
        const user = row.original

        return (
          <select
            aria-label={`Cargo de ${user.name}`}
            value={user.role}
            disabled={savingId === user.id}
            onChange={(event) => updateUser(user.id, { role: event.target.value as Role })}
            className="rounded border border-border bg-surface px-2 py-1 text-sm text-content-primary"
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
        )
      },
    }),
    columnHelper.accessor('active', {
      header: 'Ativo',
      enableSorting: true,
      cell: ({ row }) => {
        const user = row.original

        return (
          <button
            type="button"
            aria-label={`${user.active ? 'Desativar' : 'Ativar'} acesso de ${user.name}`}
            aria-pressed={user.active}
            disabled={savingId === user.id}
            onClick={() => updateUser(user.id, { active: !user.active })}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${user.active ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-surface-subtle text-content-secondary'}`}
          >
            {user.active ? 'Ativo' : 'Inativo'}
          </button>
        )
      },
    }),
    columnHelper.accessor('lastLoginAt', {
      header: 'Último login',
      enableSorting: true,
      cell: ({ row }) => <span className="text-content-muted">{row.original.lastLoginAt ? new Date(row.original.lastLoginAt).toLocaleDateString('pt-BR') : '—'}</span>,
    }),
    columnHelper.accessor('chatConnectedAt', {
      header: 'Notificações Chat',
      enableSorting: true,
      cell: ({ row }) => (
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.original.chatConnectedAt ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-surface-subtle text-content-secondary'}`}>
          {row.original.chatConnectedAt ? 'Conectado' : 'Aguardando ativação'}
        </span>
      ),
    }),
  ])

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-4" aria-label="Resumo administrativo">
        <Metric label="Contas cadastradas" value={users.length} />
        <Metric label="Contas ativas" value={activeCount} />
        <Metric label="Coordenação e direção" value={leadershipCount} />
        <Metric label="Chat conectado" value={chatConnectedCount} />
      </section>

      <form onSubmit={createUser} className="grid gap-3 rounded border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto] lg:items-end">
        <div className="space-y-1">
          <label htmlFor="new-user-name" className="text-sm font-medium text-content-primary">Nome</label>
          <input id="new-user-name" required value={newName} onChange={(e) => setNewName(e.target.value)} className="min-h-10 w-full rounded border border-border bg-surface px-2 py-2 text-sm text-content-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-user-email" className="text-sm font-medium text-content-primary">E-mail institucional</label>
          <input
            id="new-user-email"
            required
            type="email"
            placeholder="nome@colegioharmonia.com.br"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="min-h-10 w-full rounded border border-border bg-surface px-2 py-2 text-sm text-content-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-user-role" className="text-sm font-medium text-content-primary">Cargo</label>
          <select id="new-user-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className="min-h-10 w-full rounded border border-border bg-surface px-2 py-2 text-sm text-content-primary">
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={creating} className="min-h-10 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-action-primary-hover disabled:opacity-60">
          {creating ? 'Cadastrando…' : 'Cadastrar usuário'}
        </button>
      </form>

      <div className="hidden md:block">
        <DataTable columns={columns} data={users} searchableColumnId="name" searchPlaceholder="Buscar por nome..." />
      </div>

      <div className="space-y-3 md:hidden">
        {users.map((u) => (
          <article key={u.id} className="rounded-lg border border-border bg-surface p-4 shadow-soft">
            <div>
              <h2 className="font-semibold text-content-primary">{u.name}</h2>
              <p className="mt-1 break-all text-sm text-content-secondary">{u.email}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`user-role-${u.id}`} className="text-xs font-medium text-content-muted">Cargo</label>
                <select
                  id={`user-role-${u.id}`}
                  value={u.role}
                  disabled={savingId === u.id}
                  onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                  className="mt-1 min-h-10 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-content-primary"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs font-medium text-content-muted">Último login</p>
                <p className="mt-2 text-sm text-content-secondary">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('pt-BR') : 'Nunca'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-content-muted">Notificações Chat</p>
                <p className="mt-2 text-sm text-content-secondary">{u.chatConnectedAt ? 'Conectado' : 'Aguardando ativação'}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-content-muted">Situação da conta</span>
              <button
                type="button"
                disabled={savingId === u.id}
                onClick={() => updateUser(u.id, { active: !u.active })}
                className={`min-h-10 rounded-full px-3 text-xs font-medium ${u.active ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-neutral-100 text-neutral-500'}`}
              >
                {u.active ? 'Ativo' : 'Inativo'}
              </button>
            </div>
          </article>
        ))}
      </div>

      <section className="rounded border border-border bg-surface p-4">
        <h2 className="font-semibold text-content-primary">Atividade administrativa recente</h2>
        <ol className="mt-3 space-y-2 text-sm text-content-secondary">
          {audit.length === 0 && <li>Nenhuma alteração administrativa registrada.</li>}
          {audit.map((event, index) => <li key={`${event.createdAt}-${index}`}><span className="font-medium text-content-primary">{auditLabel(event.action)}</span>{event.targetUserName ? `: ${event.targetUserName}` : ''}, por {event.actorName ?? 'Sistema'} em {new Date(event.createdAt).toLocaleString('pt-BR')}.</li>)}
        </ol>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="rounded border border-border bg-surface p-4"><p className="text-sm text-content-secondary">{label}</p><p className="mt-1 text-2xl font-bold text-content-primary">{value}</p></article>
}

function auditLabel(action: string) {
  return ({ user_created: 'Conta criada', user_updated: 'Conta atualizada', user_activated: 'Conta ativada', user_deactivated: 'Conta desativada' } as Record<string, string>)[action] ?? 'Alteração registrada'
}

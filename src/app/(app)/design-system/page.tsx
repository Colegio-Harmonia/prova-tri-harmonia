import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import ThemeControls from './ThemeControls'

const colorSamples = [
  { label: 'Superficie', className: 'bg-surface text-content-primary' },
  { label: 'Acao primaria', className: 'bg-action-primary text-action-primary-foreground' },
  { label: 'Sucesso', className: 'bg-status-success text-content-inverse' },
  { label: 'Atencao', className: 'bg-status-warning text-content-inverse' },
  { label: 'Intervencao', className: 'bg-status-danger text-content-inverse' },
  { label: 'Informacao', className: 'bg-status-info text-content-inverse' },
]

export default async function DesignSystemPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  if (!isStaffSuperuser(session.user.role ?? '')) {
    redirect('/dashboard')
  }

  return (
    <div className="space-y-8 pb-12">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-harmonia-green">Fundacao visual</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-content-primary">Catalogo do Design System</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-content-secondary">
          Ambiente interno para validar a linguagem visual antes de migrar jornadas de provas, revisao e desempenho.
        </p>
      </header>

      <Card className="bg-surface-raised">
        <CardTitle>Temas por token</CardTitle>
        <CardDescription>
          A troca altera somente variaveis semanticas. Nenhum componente depende de cor fixa para comunicar estado.
        </CardDescription>
        <div className="mt-5">
          <ThemeControls />
        </div>
      </Card>

      <section aria-labelledby="colors-title">
        <div className="mb-4">
          <h2 id="colors-title" className="font-display text-2xl font-semibold tracking-tight">Cores com intencao</h2>
          <p className="mt-1 text-sm text-content-secondary">Status exige rotulo textual quando usado em telas de negocio.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colorSamples.map((sample) => (
            <div key={sample.label} className={`rounded-lg p-4 shadow-soft ${sample.className}`}>
              <p className="text-sm font-semibold">{sample.label}</p>
              <p className="mt-1 text-xs opacity-80">Token semantico</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="actions-title" className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle id="actions-title">Acoes</CardTitle>
          <CardDescription>Foco visivel, tamanhos consistentes e estado de carregamento fazem parte da primitive.</CardDescription>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button>Salvar alteracoes</Button>
            <Button variant="secondary">Voltar</Button>
            <Button variant="quiet">Cancelar</Button>
            <Button variant="danger">Excluir</Button>
            <Button loading loadingLabel="Salvando">Salvar</Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Campos</CardTitle>
          <CardDescription>Labels permanecem visiveis e erros usam mensagem programatica.</CardDescription>
          <div className="mt-5 space-y-4">
            <Field label="Nome da avaliacao" htmlFor="catalog-name" hint="Use um titulo facil de reconhecer." required>
              <Input id="catalog-name" placeholder="Ex.: Recuperacao - 8o ano" aria-describedby="catalog-name-hint" />
            </Field>
            <Field label="Codigo da turma" htmlFor="catalog-course" error="Informe um codigo valido.">
              <Input id="catalog-course" defaultValue="8A-" hasError aria-describedby="catalog-course-error" />
            </Field>
          </div>
        </Card>
      </section>
    </div>
  )
}

// Estrutura oficial da BNCC (dataset local @bncc/dados) usada para ancorar os
// pré-requisitos: de que componente é um código e o que duas habilidades têm
// em comum na própria organização da Base (objeto de conhecimento, prática de
// linguagem, unidade temática, eixo, competência específica, campo de atuação).
// A BNCC não publica pré-requisitos; isto é só a âncora oficial que a IA
// precisa respeitar antes de propor "A é base para B".

import { getOfficialBnccSkill } from './officialBncc'

type Anchor = { kind: 'objeto' | 'pratica' | 'unidade' | 'eixo' | 'competencia' | 'campo'; id: string; label: string }

const ANCHOR_LABEL: Record<Anchor['kind'], string> = {
  objeto: 'mesmo objeto de conhecimento',
  pratica: 'mesma prática de linguagem',
  unidade: 'mesma unidade temática',
  eixo: 'mesmo eixo',
  competencia: 'mesma competência específica',
  campo: 'mesmo campo de atuação',
}
// Ordem de preferência ao explicar o vínculo: do mais específico ao mais amplo.
const ANCHOR_ORDER: Anchor['kind'][] = ['objeto', 'unidade', 'pratica', 'eixo', 'competencia', 'campo']

const EF_COMPONENT: Record<string, string> = {
  portugues: 'ef-comp-lp', literatura: 'ef-comp-lp', redacao: 'ef-comp-lp',
  matematica: 'ef-comp-ma', ciencias: 'ef-comp-ci', historia: 'ef-comp-hi', geografia: 'ef-comp-ge',
  ingles: 'ef-comp-li', 'lingua inglesa': 'ef-comp-li', arte: 'ef-comp-ar', artes: 'ef-comp-ar',
  'educacao fisica': 'ef-comp-ef', 'ensino religioso': 'ef-comp-er',
}
const EM_AREA: Record<string, string> = {
  portugues: 'em-area-lgg', literatura: 'em-area-lgg', redacao: 'em-area-lgg', ingles: 'em-area-lgg', 'lingua inglesa': 'em-area-lgg',
  espanhol: 'em-area-lgg', arte: 'em-area-lgg', artes: 'em-area-lgg', 'educacao fisica': 'em-area-lgg',
  matematica: 'em-area-mat', fisica: 'em-area-cnt', quimica: 'em-area-cnt', biologia: 'em-area-cnt', ciencias: 'em-area-cnt',
  historia: 'em-area-chs', geografia: 'em-area-chs', filosofia: 'em-area-chs', sociologia: 'em-area-chs',
}
// Sigla do código quando o dataset não reconhece o código (ex.: EF15AR13 → AR).
const EF_SIGLA: Record<string, string> = { LP: 'ef-comp-lp', MA: 'ef-comp-ma', CI: 'ef-comp-ci', HI: 'ef-comp-hi', GE: 'ef-comp-ge', LI: 'ef-comp-li', AR: 'ef-comp-ar', EF: 'ef-comp-ef', ER: 'ef-comp-er' }
const EM_SIGLA: Record<string, string> = { LP: 'em-area-lgg', LGG: 'em-area-lgg', MAT: 'em-area-mat', CNT: 'em-area-cnt', CHS: 'em-area-chs' }

const normalizeCode = (code: string) => code.trim().toUpperCase()
const subjectKey = (subject: string) => { const value = subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); return value === 'lingua portuguesa' ? 'portugues' : value }
const isGeneric = (label: string) => /^todos os campos/i.test(label.trim())

/** Componente (EF) ou área (EM) do código pela BNCC; null se não reconhecido. */
export function bnccComponentOf(code: string): string | null {
  const normalized = normalizeCode(code)
  const record = getOfficialBnccSkill(normalized)?.record
  if (record) {
    if (normalized.startsWith('EM')) return record.area?.id ?? null
    return record.componente?.id ?? null
  }
  const ef = normalized.match(/^EF\d{2}([A-Z]{2})\d{2}$/)
  if (ef) return EF_SIGLA[ef[1]!] ?? null
  const em = normalized.match(/^EM13([A-Z]{2,3})\d{2,3}$/)
  if (em) return EM_SIGLA[em[1]!] ?? null
  return null
}

/**
 * O código pertence à disciplina? Disciplina sem mapeamento conhecido ou código
 * não reconhecido não é barrado (não dá para afirmar que é de outra disciplina).
 */
export function codeBelongsToSubject(code: string, subject: string, segment: string): boolean {
  const key = subjectKey(subject)
  const expected = segment === 'ensino-medio' ? EM_AREA[key] : EF_COMPONENT[key]
  if (!expected) return true
  const actual = bnccComponentOf(code)
  return !actual || actual === expected
}

function anchorsOf(code: string): Anchor[] | null {
  const record = getOfficialBnccSkill(code)?.record
  if (!record) return null
  const anchors: Anchor[] = []
  for (const item of record.objetosConhecimento ?? []) anchors.push({ kind: 'objeto', id: item.id, label: item.nome })
  const names = (record.organizacao?.nomes ?? {}) as Record<string, string | string[] | undefined>
  const push = (kind: Anchor['kind'], value: string | string[] | undefined) => {
    for (const label of Array.isArray(value) ? value : value ? [value] : []) if (!isGeneric(label)) anchors.push({ kind, id: `${kind}:${label.trim().toLowerCase()}`, label: label.trim() })
  }
  push('pratica', names.praticaLinguagem)
  push('unidade', names.unidadeTematica)
  push('eixo', names.eixo)
  push('campo', names.camposAtuacao)
  const em = record as { competenciasEspecificas?: Array<{ id: string; numero: number }>; camposAtuacaoSocial?: Array<{ id: string; nome: string }> }
  for (const item of em.competenciasEspecificas ?? []) anchors.push({ kind: 'competencia', id: item.id, label: `competência específica ${item.numero}` })
  for (const item of em.camposAtuacaoSocial ?? []) if (!isGeneric(item.nome)) anchors.push({ kind: 'campo', id: item.id, label: item.nome })
  return anchors
}

/** Rótulo curto da organização oficial de uma habilidade, para o prompt. */
export function bnccStructureLabel(code: string): string | null {
  const anchors = anchorsOf(normalizeCode(code))
  if (!anchors?.length) return null
  return ANCHOR_ORDER.flatMap((kind) => anchors.filter((anchor) => anchor.kind === kind).map((anchor) => anchor.label)).join(' · ')
}

export type StructuralLink =
  | { status: 'linked'; reason: string }
  | { status: 'unknown' }
  | { status: 'unrelated' }

/**
 * O que a habilidade-base e a alvo têm em comum na organização oficial.
 * `unknown` quando um dos códigos não está no dataset (não dá para checar).
 */
export function structuralLink(prerequisiteCode: string, skillCode: string): StructuralLink {
  const base = anchorsOf(normalizeCode(prerequisiteCode))
  const target = anchorsOf(normalizeCode(skillCode))
  if (!base || !target) return { status: 'unknown' }
  const targetIds = new Set(target.map((anchor) => anchor.id))
  for (const kind of ANCHOR_ORDER) {
    const shared = base.find((anchor) => anchor.kind === kind && targetIds.has(anchor.id))
    if (shared) return { status: 'linked', reason: `${ANCHOR_LABEL[kind]}: ${shared.label}` }
  }
  return { status: 'unrelated' }
}

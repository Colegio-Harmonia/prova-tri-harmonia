import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  CLASSIFIABLE_TYPES,
  CLASSIFICATION_SOURCES,
  CLASSIFICATION_STATUSES,
  pedagogicalCategories,
  pedagogicalClassifications,
  pedagogicalTaxonomies,
} from '@/db/schema'
import { getPedagogicalConfidenceBand } from '@/config/pedagogicalConfidence'
import {
  getClassificationAuditHistory,
  recordClassificationAudit,
  type PedagogicalAuditEntry,
} from './auditService'

export type ClassifiableType = (typeof CLASSIFIABLE_TYPES)[number]
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number]
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number]
export type PedagogicalClassification = typeof pedagogicalClassifications.$inferSelect
export type ClassificationPrecedenceCode =
  | 'human_approved'
  | 'official_validated'
  | 'reviewed_ai'
  | 'automatic_unreviewed'

export type ClassificationPrecedence = {
  code: ClassificationPrecedenceCode
  rank: 1 | 2 | 3 | 4
  label: string
}

export type ClassifiableTarget = {
  classifiableType: ClassifiableType
  classifiableId: number
  classifiableSubId?: number | null
}

export type SuggestClassificationParams = ClassifiableTarget & {
  taxonomyCode: string
  categoryCode: string
  confidence?: number | null
  source: ClassificationSource
  explanation?: string | null
  evidence?: string | null
  manualVersion?: string | null
  modelProvider?: string | null
  modelName?: string | null
  promptVersion?: string | null
  createdBy?: number | null
  isPrimary?: boolean
}

export type SupersedeClassificationParams = SuggestClassificationParams & {
  reason?: string | null
}

export type FullClassification = Record<string, PedagogicalClassification>
export type VersionChainEntry = PedagogicalClassification & {
  audit: PedagogicalAuditEntry[]
}

export type ReviewQueueParams = {
  classifiableType?: ClassifiableType
  taxonomyCode?: string
  status?: Extract<ClassificationStatus, 'sugerida' | 'em_revisao'>
  requiresHumanReviewOnly?: boolean
  limit?: number
}

export type ReviewQueueEntry = PedagogicalClassification & {
  confidenceBand: ReturnType<typeof getPedagogicalConfidenceBand>
  precedence: ClassificationPrecedence
  requiresHumanReview: boolean
}

export type MarkOutdatedByManualVersionParams = {
  taxonomyCode?: string
  fromManualVersion: string
  toManualVersion: string
  reason?: string | null
  performedBy?: number | null
}

const HUMAN_APPROVED_SOURCES: readonly ClassificationSource[] = ['TEACHER', 'PEDAGOGICAL_REVIEW']
const OFFICIAL_VALIDATED_SOURCES: readonly ClassificationSource[] = ['ENEM_IMPORT', 'MANUAL_IMPORT', 'OFFICIAL_SOURCE']
const REVIEWABLE_STATUSES: readonly ClassificationStatus[] = ['sugerida', 'em_revisao']
const PROTECTED_CURRENT_STATUSES: readonly ClassificationStatus[] = ['aprovada', 'em_revisao']

function normalizedSubId(classifiableSubId: number | null | undefined) {
  return classifiableSubId ?? null
}

function isStatusIn(status: ClassificationStatus, statuses: readonly ClassificationStatus[]) {
  return statuses.includes(status)
}

function assertReviewableStatus(classification: PedagogicalClassification, action: string) {
  if (!isStatusIn(classification.status, REVIEWABLE_STATUSES)) {
    throw new Error(
      `Classificacao ${classification.id} esta com status ${classification.status} e nao pode ser ${action}.`,
    )
  }
}

function isProtectedCurrent(classification: PedagogicalClassification) {
  return isStatusIn(classification.status, PROTECTED_CURRENT_STATUSES)
}

export function getClassificationPrecedence(classification: PedagogicalClassification): ClassificationPrecedence {
  if (classification.status === 'aprovada' && HUMAN_APPROVED_SOURCES.includes(classification.source)) {
    return { code: 'human_approved', rank: 1, label: 'Classificacao humana aprovada' }
  }

  if (classification.status === 'aprovada' && OFFICIAL_VALIDATED_SOURCES.includes(classification.source)) {
    return { code: 'official_validated', rank: 2, label: 'Fonte oficial validada' }
  }

  if (classification.status === 'aprovada') {
    return { code: 'reviewed_ai', rank: 3, label: 'Classificacao revisada e aprovada' }
  }

  return { code: 'automatic_unreviewed', rank: 4, label: 'Classificacao automatica ainda nao revisada' }
}

export function requiresHumanReview(classification: PedagogicalClassification) {
  if (classification.status === 'em_revisao') return true
  if (classification.status !== 'sugerida') return false

  const band = getPedagogicalConfidenceBand(classification.confidence)
  return band === 'unscored' || band === 'review_required' || band === 'below_threshold'
}

function sameClassifiableWhere(
  target: ClassifiableTarget,
  taxonomyId: number,
  excludeClassificationId?: number,
) {
  const subId = normalizedSubId(target.classifiableSubId)
  const conditions = [
    eq(pedagogicalClassifications.classifiableType, target.classifiableType),
    eq(pedagogicalClassifications.classifiableId, target.classifiableId),
    subId === null
      ? isNull(pedagogicalClassifications.classifiableSubId)
      : eq(pedagogicalClassifications.classifiableSubId, subId),
    eq(pedagogicalClassifications.taxonomyId, taxonomyId),
  ]

  if (excludeClassificationId) {
    conditions.push(ne(pedagogicalClassifications.id, excludeClassificationId))
  }

  return and(...conditions)
}

async function resolveTaxonomyAndCategory(taxonomyCode: string, categoryCode: string) {
  const taxonomy = await db.query.pedagogicalTaxonomies.findFirst({
    where: and(
      eq(pedagogicalTaxonomies.code, taxonomyCode),
      eq(pedagogicalTaxonomies.isActive, true),
    ),
  })

  if (!taxonomy) {
    throw new Error(`Taxonomia pedagogica nao encontrada ou inativa: ${taxonomyCode}`)
  }

  const category = await db.query.pedagogicalCategories.findFirst({
    where: and(
      eq(pedagogicalCategories.taxonomyId, taxonomy.id),
      eq(pedagogicalCategories.code, categoryCode),
      eq(pedagogicalCategories.isActive, true),
    ),
  })

  if (!category) {
    throw new Error(`Categoria pedagogica nao encontrada ou inativa: ${taxonomyCode}/${categoryCode}`)
  }

  return { taxonomy, category }
}

export async function suggest(params: SuggestClassificationParams): Promise<PedagogicalClassification> {
  const { taxonomy, category } = await resolveTaxonomyAndCategory(params.taxonomyCode, params.categoryCode)
  const current = await getCurrent(params.classifiableType, params.classifiableId, params.classifiableSubId, params.taxonomyCode)
  const shouldBeCurrent = !current || !isProtectedCurrent(current)

  return db.transaction(async (tx) => {
    if (shouldBeCurrent && current) {
      await tx
        .update(pedagogicalClassifications)
        .set({ status: 'substituida', isCurrent: false, updatedAt: new Date() })
        .where(eq(pedagogicalClassifications.id, current.id))

      await recordClassificationAudit(tx, {
        classificationId: current.id,
        action: 'superseded',
        previousValue: current,
        newValue: { status: 'substituida', isCurrent: false },
        reason: 'Nova sugestao substituiu classificacao corrente nao aprovada.',
        performedBy: params.createdBy ?? null,
      })
    }

    const [created] = await tx
      .insert(pedagogicalClassifications)
      .values({
        classifiableType: params.classifiableType,
        classifiableId: params.classifiableId,
        classifiableSubId: normalizedSubId(params.classifiableSubId),
        taxonomyId: taxonomy.id,
        categoryId: category.id,
        classificationCode: category.code,
        isPrimary: params.isPrimary ?? true,
        confidence: params.confidence ?? null,
        source: params.source,
        status: 'sugerida',
        isCurrent: shouldBeCurrent,
        explanation: params.explanation ?? null,
        evidence: params.evidence ?? null,
        manualVersion: params.manualVersion ?? taxonomy.manualVersion,
        modelProvider: params.modelProvider ?? null,
        modelName: params.modelName ?? null,
        promptVersion: params.promptVersion ?? null,
        version: current ? current.version + 1 : 1,
        supersedesId: shouldBeCurrent ? current?.id ?? null : null,
        createdBy: params.createdBy ?? null,
        updatedAt: new Date(),
      })
      .returning()

    if (!created) {
      throw new Error('Falha ao criar classificacao pedagogica sugerida.')
    }

    await recordClassificationAudit(tx, {
      classificationId: created.id,
      action: 'created',
      previousValue: null,
      newValue: created,
      reason: shouldBeCurrent
        ? 'Classificacao sugerida criada como corrente.'
        : 'Classificacao sugerida criada sem substituir classificacao aprovada corrente.',
      performedBy: params.createdBy ?? null,
    })

    return created
  })
}

export async function approve(classificationId: number, approvedBy: number): Promise<PedagogicalClassification> {
  const classification = await db.query.pedagogicalClassifications.findFirst({
    where: eq(pedagogicalClassifications.id, classificationId),
  })

  if (!classification) {
    throw new Error(`Classificacao pedagogica nao encontrada: ${classificationId}`)
  }

  assertReviewableStatus(classification, 'aprovada')

  return db.transaction(async (tx) => {
    const activeConflicts = await tx.query.pedagogicalClassifications.findMany({
      where: and(
        sameClassifiableWhere(classification, classification.taxonomyId, classification.id),
        eq(pedagogicalClassifications.isCurrent, true),
      ),
    })

    for (const conflict of activeConflicts) {
      await tx
        .update(pedagogicalClassifications)
        .set({ status: 'substituida', isCurrent: false, updatedAt: new Date() })
        .where(eq(pedagogicalClassifications.id, conflict.id))

      await recordClassificationAudit(tx, {
        classificationId: conflict.id,
        action: 'superseded',
        previousValue: conflict,
        newValue: { status: 'substituida', isCurrent: false },
        reason: `Substituida pela aprovacao da classificacao ${classification.id}.`,
        performedBy: approvedBy,
      })
    }

    const [approved] = await tx
      .update(pedagogicalClassifications)
      .set({
        status: 'aprovada',
        isCurrent: true,
        approvedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pedagogicalClassifications.id, classification.id))
      .returning()

    if (!approved) {
      throw new Error(`Falha ao aprovar classificacao pedagogica: ${classification.id}`)
    }

    await recordClassificationAudit(tx, {
      classificationId: approved.id,
      action: 'approved',
      previousValue: classification,
      newValue: approved,
      reason: 'Classificacao aprovada por revisao humana.',
      performedBy: approvedBy,
    })

    return approved
  })
}

export async function reject(
  classificationId: number,
  reason: string,
  performedBy: number,
): Promise<PedagogicalClassification> {
  const classification = await db.query.pedagogicalClassifications.findFirst({
    where: eq(pedagogicalClassifications.id, classificationId),
  })

  if (!classification) {
    throw new Error(`Classificacao pedagogica nao encontrada: ${classificationId}`)
  }

  assertReviewableStatus(classification, 'rejeitada')

  return db.transaction(async (tx) => {
    const [rejected] = await tx
      .update(pedagogicalClassifications)
      .set({ status: 'rejeitada', isCurrent: false, updatedAt: new Date() })
      .where(eq(pedagogicalClassifications.id, classification.id))
      .returning()

    if (!rejected) {
      throw new Error(`Falha ao rejeitar classificacao pedagogica: ${classification.id}`)
    }

    await recordClassificationAudit(tx, {
      classificationId: rejected.id,
      action: 'rejected',
      previousValue: classification,
      newValue: rejected,
      reason,
      performedBy,
    })

    return rejected
  })
}

export async function supersede(
  oldClassificationId: number,
  newParams: SupersedeClassificationParams,
  performedBy: number,
): Promise<PedagogicalClassification> {
  const oldClassification = await db.query.pedagogicalClassifications.findFirst({
    where: eq(pedagogicalClassifications.id, oldClassificationId),
  })

  if (!oldClassification) {
    throw new Error(`Classificacao pedagogica nao encontrada: ${oldClassificationId}`)
  }

  const { taxonomy, category } = await resolveTaxonomyAndCategory(newParams.taxonomyCode, newParams.categoryCode)

  if (taxonomy.id !== oldClassification.taxonomyId) {
    throw new Error('A substituicao deve preservar a mesma taxonomia da classificacao original.')
  }

  return db.transaction(async (tx) => {
    const activeConflicts = await tx.query.pedagogicalClassifications.findMany({
      where: and(
        sameClassifiableWhere(newParams, taxonomy.id),
        eq(pedagogicalClassifications.isCurrent, true),
      ),
    })

    for (const conflict of activeConflicts) {
      await tx
        .update(pedagogicalClassifications)
        .set({ status: 'substituida', isCurrent: false, updatedAt: new Date() })
        .where(eq(pedagogicalClassifications.id, conflict.id))

      await recordClassificationAudit(tx, {
        classificationId: conflict.id,
        action: 'superseded',
        previousValue: conflict,
        newValue: { status: 'substituida', isCurrent: false },
        reason: newParams.reason ?? 'Classificacao substituida explicitamente.',
        performedBy,
      })
    }

    const [created] = await tx
      .insert(pedagogicalClassifications)
      .values({
        classifiableType: newParams.classifiableType,
        classifiableId: newParams.classifiableId,
        classifiableSubId: normalizedSubId(newParams.classifiableSubId),
        taxonomyId: taxonomy.id,
        categoryId: category.id,
        classificationCode: category.code,
        isPrimary: newParams.isPrimary ?? true,
        confidence: newParams.confidence ?? null,
        source: newParams.source,
        status: 'aprovada',
        isCurrent: true,
        explanation: newParams.explanation ?? null,
        evidence: newParams.evidence ?? null,
        manualVersion: newParams.manualVersion ?? taxonomy.manualVersion,
        modelProvider: newParams.modelProvider ?? null,
        modelName: newParams.modelName ?? null,
        promptVersion: newParams.promptVersion ?? null,
        version: oldClassification.version + 1,
        supersedesId: oldClassification.id,
        createdBy: newParams.createdBy ?? performedBy,
        approvedBy: performedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (!created) {
      throw new Error(`Falha ao substituir classificacao pedagogica: ${oldClassification.id}`)
    }

    await recordClassificationAudit(tx, {
      classificationId: created.id,
      action: 'created',
      previousValue: oldClassification,
      newValue: created,
      reason: newParams.reason ?? 'Nova classificacao aprovada criada por substituicao explicita.',
      performedBy,
    })

    return created
  })
}

export async function beginReview(
  classificationId: number,
  performedBy: number,
  reason?: string | null,
): Promise<PedagogicalClassification> {
  const classification = await db.query.pedagogicalClassifications.findFirst({
    where: eq(pedagogicalClassifications.id, classificationId),
  })

  if (!classification) {
    throw new Error(`Classificacao pedagogica nao encontrada: ${classificationId}`)
  }

  if (classification.status === 'em_revisao') {
    return classification
  }

  assertReviewableStatus(classification, 'colocada em revisao')

  return db.transaction(async (tx) => {
    const [reviewing] = await tx
      .update(pedagogicalClassifications)
      .set({ status: 'em_revisao', updatedAt: new Date() })
      .where(eq(pedagogicalClassifications.id, classification.id))
      .returning()

    if (!reviewing) {
      throw new Error(`Falha ao iniciar revisao da classificacao pedagogica: ${classification.id}`)
    }

    await recordClassificationAudit(tx, {
      classificationId: reviewing.id,
      action: 'edited',
      previousValue: classification,
      newValue: { status: 'em_revisao' },
      reason: reason ?? 'Classificacao encaminhada para revisao humana.',
      performedBy,
    })

    return reviewing
  })
}

export async function getReviewQueue(params: ReviewQueueParams = {}): Promise<ReviewQueueEntry[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const statuses: ClassificationStatus[] = params.status
    ? [params.status]
    : ['sugerida', 'em_revisao']
  const conditions = [
    inArray(pedagogicalClassifications.status, statuses),
    eq(pedagogicalClassifications.isCurrent, true),
  ]

  if (params.classifiableType) {
    conditions.push(eq(pedagogicalClassifications.classifiableType, params.classifiableType))
  }

  if (params.taxonomyCode) {
    const taxonomy = await db.query.pedagogicalTaxonomies.findFirst({
      where: eq(pedagogicalTaxonomies.code, params.taxonomyCode),
    })

    if (!taxonomy) {
      throw new Error(`Taxonomia pedagogica nao encontrada: ${params.taxonomyCode}`)
    }

    conditions.push(eq(pedagogicalClassifications.taxonomyId, taxonomy.id))
  }

  const classifications = await db.query.pedagogicalClassifications.findMany({
    where: and(...conditions),
    orderBy: [
      desc(pedagogicalClassifications.updatedAt),
      desc(pedagogicalClassifications.createdAt),
    ],
    limit,
  })

  return classifications
    .map((classification) => ({
      ...classification,
      confidenceBand: getPedagogicalConfidenceBand(classification.confidence),
      precedence: getClassificationPrecedence(classification),
      requiresHumanReview: requiresHumanReview(classification),
    }))
    .filter((classification) => (
      params.requiresHumanReviewOnly ? classification.requiresHumanReview : true
    ))
}

export async function getCurrent(
  classifiableType: ClassifiableType,
  classifiableId: number,
  classifiableSubId: number | null | undefined,
  taxonomyCode: string,
): Promise<PedagogicalClassification | null> {
  const taxonomy = await db.query.pedagogicalTaxonomies.findFirst({
    where: eq(pedagogicalTaxonomies.code, taxonomyCode),
  })

  if (!taxonomy) return null

  const classification = await db.query.pedagogicalClassifications.findFirst({
    where: and(
      sameClassifiableWhere({ classifiableType, classifiableId, classifiableSubId }, taxonomy.id),
      eq(pedagogicalClassifications.isCurrent, true),
    ),
    orderBy: [desc(pedagogicalClassifications.createdAt)],
  })

  return classification ?? null
}

export async function getFullClassification(
  classifiableType: ClassifiableType,
  classifiableId: number,
  classifiableSubId?: number | null,
): Promise<FullClassification> {
  const subId = normalizedSubId(classifiableSubId)
  const [classifications, taxonomies] = await Promise.all([
    db.query.pedagogicalClassifications.findMany({
      where: and(
        eq(pedagogicalClassifications.classifiableType, classifiableType),
        eq(pedagogicalClassifications.classifiableId, classifiableId),
        subId === null
          ? isNull(pedagogicalClassifications.classifiableSubId)
          : eq(pedagogicalClassifications.classifiableSubId, subId),
        eq(pedagogicalClassifications.isCurrent, true),
      ),
    }),
    db.query.pedagogicalTaxonomies.findMany(),
  ])

  const taxonomyCodeById = new Map(taxonomies.map((taxonomy) => [taxonomy.id, taxonomy.code]))

  return classifications.reduce<FullClassification>((acc, classification) => {
    const taxonomyCode = taxonomyCodeById.get(classification.taxonomyId)
    if (taxonomyCode) acc[taxonomyCode] = classification
    return acc
  }, {})
}

export async function getHistory(classificationId: number): Promise<PedagogicalAuditEntry[]> {
  return getClassificationAuditHistory(classificationId)
}

export async function getVersionChain(classificationId: number): Promise<VersionChainEntry[]> {
  const chain: VersionChainEntry[] = []
  const seen = new Set<number>()
  let currentId: number | null = classificationId

  while (currentId !== null) {
    if (seen.has(currentId)) {
      throw new Error(`Ciclo de versionamento detectado na classificacao ${currentId}`)
    }
    seen.add(currentId)

    const classification: PedagogicalClassification | undefined = await db.query.pedagogicalClassifications.findFirst({
      where: eq(pedagogicalClassifications.id, currentId),
    })

    if (!classification) {
      if (currentId === classificationId) {
        throw new Error(`Classificacao pedagogica nao encontrada: ${classificationId}`)
      }
      break
    }

    const audit = await getHistory(classification.id)
    chain.push({ ...classification, audit })
    currentId = classification.supersedesId ?? null
  }

  return chain
}

export async function markOutdatedByManualVersion(
  params: MarkOutdatedByManualVersionParams,
): Promise<PedagogicalClassification[]> {
  const taxonomies = params.taxonomyCode
    ? await db.query.pedagogicalTaxonomies.findMany({
        where: eq(pedagogicalTaxonomies.code, params.taxonomyCode),
      })
    : await db.query.pedagogicalTaxonomies.findMany()

  if (params.taxonomyCode && taxonomies.length === 0) {
    throw new Error(`Taxonomia pedagogica nao encontrada: ${params.taxonomyCode}`)
  }

  const taxonomyIds = new Set(taxonomies.map((taxonomy) => taxonomy.id))
  const candidates = await db.query.pedagogicalClassifications.findMany({
    where: and(
      eq(pedagogicalClassifications.manualVersion, params.fromManualVersion),
      eq(pedagogicalClassifications.isCurrent, true),
    ),
  })

  const scopedCandidates = candidates.filter((classification) => taxonomyIds.has(classification.taxonomyId))
  const reason = params.reason
    ?? `Manual pedagogico atualizado de ${params.fromManualVersion} para ${params.toManualVersion}.`

  return db.transaction(async (tx) => {
    const updated: PedagogicalClassification[] = []

    for (const classification of scopedCandidates) {
      const [outdated] = await tx
        .update(pedagogicalClassifications)
        .set({
          status: 'desatualizada',
          isCurrent: false,
          updatedAt: new Date(),
        })
        .where(eq(pedagogicalClassifications.id, classification.id))
        .returning()

      if (!outdated) continue

      await recordClassificationAudit(tx, {
        classificationId: outdated.id,
        action: 'outdated',
        previousValue: classification,
        newValue: {
          status: 'desatualizada',
          isCurrent: false,
          fromManualVersion: params.fromManualVersion,
          toManualVersion: params.toManualVersion,
        },
        reason,
        performedBy: params.performedBy ?? null,
      })

      updated.push(outdated)
    }

    return updated
  })
}

import type { docs_v1 } from 'googleapis'
import { getDriveClient, getDocsClient } from './driveClient'
import { applyA4PageSize } from './pageSetup'
import { applyProvaContent } from './provaDocBuilder'
import { buildAssessmentMeta } from './assessmentMeta'
import { COMMAND_KEYWORDS } from '@/config/adaptationLibraries'
import type { AdaptedExamPayload } from '@/lib/adaptation/adaptExam'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { Segment } from '@/types/exam'

// Documento "Prova Adaptada" (Módulo 4, spec 4.4): mesmo template/pipeline
// da prova comum, com o conteúdo já adaptado pela IA (revisado por humano)
// e um pós-passo DETERMINÍSTICO de diagramação — fonte ampliada,
// espaçamento, negrito de palavras-chave. Nada de diagramação passa pela
// IA. LGPD: o cabeçalho indica só os perfis/bibliotecas, nunca o aluno.

type ExamRowInfo = {
  segment: Segment
  gradeYear: number
  subject: string
  bimester: number | null
  driveFolderId: string | null
}

function profileTitleLabel(profiles: string[]): string {
  return profiles.map((p) => p.replace('_', ' ').toUpperCase()).join(' + ')
}

// Payload sintético pro builder da prova: campos de forma já substituídos
// no adaptExam; aqui só materializamos os apoios textuais (fórmulas de
// consulta, descrição de imagem) dentro do texto impresso.
function buildPrintablePayload(adapted: AdaptedExamPayload): ExamGenerationResult {
  return {
    metadata: adapted.metadata,
    questions: adapted.questions.map((q) => {
      let statement = q.statement
      if (q.adaptation.formulaSupport) {
        statement += `\n\nApoio permitido (consulta liberada): ${q.adaptation.formulaSupport}`
      }
      let supportText = q.supportText ?? null
      if (q.adaptation.imageDescription) {
        supportText = `${supportText ? `${supportText}\n\n` : ''}Descrição da imagem: ${q.adaptation.imageDescription}`
      }
      return { ...q, statement, supportText }
    }),
  } as ExamGenerationResult
}

// Pós-passo de diagramação via Docs API: estilos aplicados ao documento
// inteiro depois do conteúdo entrar (fonte/espaçamento), e negrito por
// palavra-chave de comando localizada nos textRuns reais.
async function applyAdaptationLayout(
  docs: docs_v1.Docs,
  documentId: string,
  layout: AdaptedExamPayload['metadata']['adaptation']['layout'],
): Promise<void> {
  const { data: document } = await docs.documents.get({ documentId })
  const content = document.body?.content ?? []
  const endIndex = content.at(-1)?.endIndex
  if (!endIndex || endIndex <= 2) return

  const requests: docs_v1.Schema$Request[] = []
  // O último newline do body não aceita updateTextStyle — para em endIndex-1.
  const fullRange = { startIndex: 1, endIndex: endIndex - 1 }

  if (layout.minFontPt || layout.fontFamily) {
    requests.push({
      updateTextStyle: {
        range: fullRange,
        textStyle: {
          ...(layout.minFontPt ? { fontSize: { magnitude: layout.minFontPt, unit: 'PT' } } : {}),
          ...(layout.fontFamily === 'sans-serif' ? { weightedFontFamily: { fontFamily: 'Arial' } } : {}),
        },
        fields: [layout.minFontPt ? 'fontSize' : null, layout.fontFamily ? 'weightedFontFamily' : null].filter(Boolean).join(','),
      },
    })
  }

  if (layout.lineSpacing) {
    requests.push({
      updateParagraphStyle: {
        range: fullRange,
        paragraphStyle: { lineSpacing: layout.lineSpacing * 100 },
        fields: 'lineSpacing',
      },
    })
  }

  if (layout.boldCommandKeywords) {
    for (const element of content) {
      for (const pe of element.paragraph?.elements ?? []) {
        const text = pe.textRun?.content
        if (!text || pe.startIndex == null) continue
        for (const keyword of COMMAND_KEYWORDS) {
          let from = 0
          while (true) {
            const at = text.indexOf(keyword, from)
            if (at === -1) break
            const before = at === 0 ? ' ' : text[at - 1]
            const after = text[at + keyword.length] ?? ' '
            // Palavra inteira: evita negritar "NÃO" dentro de "NÃOSEI" etc.
            if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
              requests.push({
                updateTextStyle: {
                  range: { startIndex: pe.startIndex + at, endIndex: pe.startIndex + at + keyword.length },
                  textStyle: { bold: true },
                  fields: 'bold',
                },
              })
            }
            from = at + keyword.length
          }
        }
      }
    }
  }

  if (requests.length) {
    await docs.documents.batchUpdate({ documentId, requestBody: { requests } })
  }
}

export async function generateAdaptedProvaDoc(
  exam: ExamRowInfo,
  adaptedPayload: AdaptedExamPayload,
): Promise<{ docId: string; url: string }> {
  const provaTemplateId = process.env.TEMPLATE_PROVA_DOC_ID
  if (!provaTemplateId) throw new Error('Template do Google Docs não configurado (TEMPLATE_PROVA_DOC_ID).')
  if (!exam.driveFolderId) throw new Error('A prova original ainda não tem pasta no Drive (aprovação gera a pasta) — aprove a prova antes de gerar a adaptada.')

  const drive = getDriveClient()
  const docs = getDocsClient()

  const profiles = adaptedPayload.metadata.adaptation.profiles
  const profileLabel = profileTitleLabel(profiles)

  const { data } = await drive.files.copy({
    fileId: provaTemplateId,
    requestBody: {
      name: `Prova Adaptada (${profileLabel}) - ${exam.subject} - ${exam.gradeYear}º ano`,
      parents: [exam.driveFolderId],
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  })
  const docId = data.id as string
  const url = (data.webViewLink as string) ?? `https://docs.google.com/document/d/${docId}/edit`

  const baseMeta = buildAssessmentMeta({ segment: exam.segment, gradeYear: exam.gradeYear, subject: exam.subject, bimester: exam.bimester })
  const meta = {
    ...baseMeta,
    // Só perfis/bibliotecas no cabeçalho — nunca o nome do aluno (LGPD).
    tituloProva: `PROVA ADAPTADA (${profileLabel}) - ${exam.subject.toUpperCase()}`,
  }

  await applyA4PageSize(docs, docId)
  await applyProvaContent(docs, docId, buildPrintablePayload(adaptedPayload), meta, {
    discursiveBlankLines: adaptedPayload.metadata.adaptation.layout.extraAnswerSpace ? 9 : 5,
  })
  await applyAdaptationLayout(docs, docId, adaptedPayload.metadata.adaptation.layout)

  return { docId, url }
}

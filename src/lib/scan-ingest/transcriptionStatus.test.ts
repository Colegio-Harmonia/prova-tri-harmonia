import { describe, expect, it } from 'vitest'
import { latestRelevantTranscriptionPages, sheetPageNumberForQuestion, summarizeTranscriptions } from './transcriptionStatus'
import type { CorrectionAnswer } from '@/types/correction'

const answer = (questionNumber: number, transcribedAnswer = ''): CorrectionAnswer => ({
  questionNumber,
  type: 'descritiva',
  transcribedAnswer,
  correctLetter: null,
  isCorrect: null,
  aiSuggestedGrade: null,
  aiSuggestedFeedback: null,
  finalGrade: null,
  finalFeedback: null,
})

describe('estado da transcrição discursiva', () => {
  it('preserva o número físico quando há página objetiva antes das discursivas', () => {
    const plan = [
      { questions: [{ number: 2 }, { number: 4 }] },
      { questions: [{ number: 1 }, { number: 3 }, { number: 5 }] },
      { questions: [{ number: 8 }, { number: 10 }] },
    ]

    expect(sheetPageNumberForQuestion(plan, 1)).toBe(2)
    expect(sheetPageNumberForQuestion(plan, 8)).toBe(3)
  })

  it('ignora página de outra prova ao escolher a página atual', () => {
    const pages = latestRelevantTranscriptionPages([
      { id: 2, sheetPageNumber: 3, status: 'needs_review', exceptionCode: 'SCAN_BELONGS_TO_ANOTHER_EXAM', createdAt: new Date('2026-09-23T12:00:00Z') },
      { id: 1, sheetPageNumber: 3, status: 'processed', exceptionCode: null, createdAt: new Date('2026-09-23T11:00:00Z') },
    ], (page) => String(page.sheetPageNumber))

    expect(pages.map((page) => page.id)).toEqual([1])
  })

  it('mantém a aprovação bloqueada enquanto uma resposta está em processamento', () => {
    const summary = summarizeTranscriptions({
      answers: [answer(11), answer(12)],
      discursiveQuestionNumbers: new Set([11, 12]),
      pages: [],
      readings: [{ pageId: 1, questionNumber: 11, suggestedTranscription: null, exceptionCode: 'OCR_PROCESSING' }],
      pageForQuestion: new Map([[11, { id: 1, sheetPageNumber: 2 }], [12, { id: 2, sheetPageNumber: 2 }]]),
      activeJobs: [
        { pageId: 1, questionNumbers: [11], status: 'gerando' },
        { pageId: 2, questionNumbers: [12], status: 'pendente' },
      ],
    })

    expect(summary.processing).toBe(1)
    expect(summary.queued).toBe(1)
    expect(summary.active).toBe(2)
    expect(summary.canApprove).toBe(false)
  })

  it('libera quando a IA terminou e a outra resposta foi preenchida manualmente', () => {
    const summary = summarizeTranscriptions({
      answers: [answer(11), answer(12, 'Resposta digitada pelo professor')],
      discursiveQuestionNumbers: new Set([11, 12]),
      pages: [],
      readings: [{ pageId: 1, questionNumber: 11, suggestedTranscription: 'Texto lido', confirmedTranscription: 'Texto lido', exceptionCode: null }],
      pageForQuestion: new Map([[11, { id: 1, sheetPageNumber: 2 }], [12, { id: 2, sheetPageNumber: 2 }]]),
    })

    expect(summary.completed).toBe(2)
    expect(summary.active).toBe(0)
    expect(summary.canApprove).toBe(true)
  })

  it('não confunde uma leitura sem status com uma transcrição em andamento', () => {
    const summary = summarizeTranscriptions({
      answers: [answer(11)],
      discursiveQuestionNumbers: new Set([11]),
      pages: [],
      readings: [{ pageId: 1, questionNumber: 11, suggestedTranscription: null, exceptionCode: null }],
      pageForQuestion: new Map([[11, { id: 1, sheetPageNumber: 2 }]]),
    })

    expect(summary.active).toBe(0)
    expect(summary.queued).toBe(0)
    expect(summary.needsReview).toBe(1)
    expect(summary.canApprove).toBe(false)
  })

  it('não bloqueia como ativa uma leitura órfã sem trabalho correspondente', () => {
    const summary = summarizeTranscriptions({
      answers: [answer(11)],
      discursiveQuestionNumbers: new Set([11]),
      pages: [],
      readings: [{ pageId: 1, questionNumber: 11, suggestedTranscription: null, exceptionCode: 'OCR_PROCESSING' }],
      pageForQuestion: new Map([[11, { id: 1, sheetPageNumber: 2 }]]),
      activeJobs: [],
    })

    expect(summary.active).toBe(0)
    expect(summary.processing).toBe(0)
    expect(summary.needsReview).toBe(1)
    expect(summary.canApprove).toBe(false)
  })

  it('libera a pendência quando o professor encerra a revisão como sem resposta', () => {
    const summary = summarizeTranscriptions({
      answers: [answer(11)],
      discursiveQuestionNumbers: new Set([11]),
      pages: [],
      readings: [{ pageId: 1, questionNumber: 11, suggestedTranscription: null, exceptionCode: 'OCR_UNREADABLE', reviewStatus: 'rejected' }],
      pageForQuestion: new Map([[11, { id: 1, sheetPageNumber: 2 }]]),
    })

    expect(summary.completed).toBe(1)
    expect(summary.needsReview).toBe(0)
    expect(summary.canApprove).toBe(true)
  })

  it('não quebra quando uma correção legada tem respostas em formato de objeto', () => {
    const summary = summarizeTranscriptions({
      answers: {},
      discursiveQuestionNumbers: new Set([11]),
      pages: [],
      readings: [],
      pageForQuestion: new Map(),
    })

    expect(summary.total).toBe(0)
    expect(summary.canApprove).toBe(true)
  })
})

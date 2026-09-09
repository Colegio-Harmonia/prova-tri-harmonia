import JSZip from 'jszip'

export const ENEM_SAE_AREAS = ['LC', 'CH', 'CN', 'MT'] as const
export type EnemSaeArea = (typeof ENEM_SAE_AREAS)[number]

type Question = { id: string; number: number; area: EnemSaeArea; column: string; expectedSchoolAccuracy: number | null }
type StudentAreaPercent = Record<EnemSaeArea, number | null>

export type EnemSaeQuestion = Omit<Question, 'column' | 'expectedSchoolAccuracy'> & {
  correct: number
  answered: number
  accuracyPercent: number | null
  discipline?: string
  competence?: string
  skill?: string
  topic?: string
  answerKey?: string
  nationalAccuracyPercent?: number | null
  schoolAccuracyPercent?: number | null
  schoolDifferencePercent?: number | null
}

export type EnemSaeStudent = {
  name: string
  overallPercent: number | null
  correct: number
  answered: number
  areas: StudentAreaPercent
  answers: Record<string, boolean | null>
}

export type EnemSaeAnalysis = {
  students: EnemSaeStudent[]
  areas: Record<EnemSaeArea, { correct: number; answered: number; accuracyPercent: number | null }>
  questions: EnemSaeQuestion[]
  summary: { studentCount: number; answeredItems: number; overallPercent: number | null; belowReferenceCount: number }
}

type QuestionMatrixRow = {
  number: number
  area: EnemSaeArea
  discipline: string
  competence: string
  skill: string
  topic: string
  answerKey: string
  nationalAccuracyFraction: number | null
  schoolAccuracyFraction: number | null
  schoolDifferenceFraction: number | null
  nationalAccuracyPercent: number | null
  schoolAccuracyPercent: number | null
  schoolDifferencePercent: number | null
}

type CellRows = Map<number, Map<string, string>>

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(d+);/g, (_, decimal) => String.fromCharCode(Number(decimal)))
}

function columnFromReference(reference: string) {
  return reference.replace(/\d/g, '')
}

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('pt-BR')
}

function percent(correct: number, answered: number) {
  return answered === 0 ? null : Math.round((correct / answered) * 100)
}

function decimalPercent(value: string | undefined) {
  if (!value) return null
  const normalized = value.trim().replace(',', '.')
  if (!normalized || normalized === '-') return null
  const number = Number(normalized.endsWith('%') ? normalized.slice(0, -1) : normalized)
  if (!Number.isFinite(number)) return null
  return normalized.endsWith('%') || number > 1 ? number / 100 : number
}

function normalizedLabel(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function parseQuestions(header: Map<string, string>, summary: Map<string, string>) {
  const questions: Question[] = []
  for (const [column, value] of header) {
    if (column === 'A' || column === 'B') continue
    const match = value.trim().match(/^(\d+)(?:-(IN|ES))?-(LC|CH|CN|MT)$/i)
    if (!match) continue
    questions.push({
      id: value.trim(),
      number: Number(match[1]),
      area: match[3].toUpperCase() as EnemSaeArea,
      column,
      expectedSchoolAccuracy: decimalPercent(summary.get(column)),
    })
  }
  return questions
}

function matrixColumn(header: Map<string, string>, label: string) {
  return [...header.entries()].find(([, value]) => normalizedLabel(value) === normalizedLabel(label))?.[0]
}

async function parseQuestionMatrix(buffer: ArrayBuffer): Promise<QuestionMatrixRow[]> {
  const rows = await readRows(buffer)
  const header = rows.get(1)
  if (!header) throw new Error('A matriz de questões não possui o cabeçalho esperado.')

  const labels = {
    number: matrixColumn(header, 'Posição'),
    area: matrixColumn(header, 'Área'),
    discipline: matrixColumn(header, 'Disciplina'),
    competence: matrixColumn(header, 'Competência'),
    skill: matrixColumn(header, 'Habilidade'),
    topic: matrixColumn(header, 'Tópico'),
    answerKey: matrixColumn(header, 'Gabarito'),
    national: matrixColumn(header, 'Porcentagem acerto geral'),
    school: matrixColumn(header, 'Porcentagem de acerto escola'),
    difference: matrixColumn(header, 'Diferença'),
  }
  if (Object.values(labels).some((column) => !column)) {
    throw new Error('Matriz inválida: espero as colunas Posição, Área, Disciplina, Competência, Habilidade, Tópico e indicadores de acerto.')
  }

  const matrix: QuestionMatrixRow[] = []
  for (const [rowNumber, row] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    if (rowNumber < 2) continue
    const number = Number(row.get(labels.number!))
    const area = row.get(labels.area!)?.trim().toUpperCase() as EnemSaeArea | undefined
    if (!Number.isInteger(number) || !area || !ENEM_SAE_AREAS.includes(area)) continue
    const discipline = row.get(labels.discipline!)?.trim()
    const competence = row.get(labels.competence!)?.trim()
    const skill = row.get(labels.skill!)?.trim()
    const topic = row.get(labels.topic!)?.trim()
    if (!discipline || !competence || !skill || !topic) {
      throw new Error(`Matriz inválida: a linha ${rowNumber} não possui a classificação pedagógica completa.`)
    }
    const nationalAccuracyFraction = decimalPercent(row.get(labels.national!))
    const schoolAccuracyFraction = decimalPercent(row.get(labels.school!))
    const schoolDifferenceFraction = decimalPercent(row.get(labels.difference!))
    matrix.push({
      number,
      area,
      discipline,
      competence,
      skill,
      topic,
      answerKey: row.get(labels.answerKey!)?.trim() ?? '',
      nationalAccuracyFraction,
      schoolAccuracyFraction,
      schoolDifferenceFraction,
      nationalAccuracyPercent: percentFromDecimal(nationalAccuracyFraction),
      schoolAccuracyPercent: percentFromDecimal(schoolAccuracyFraction),
      schoolDifferencePercent: percentFromDecimal(schoolDifferenceFraction),
    })
  }
  return matrix
}

function percentFromDecimal(value: number | null) {
  return value === null ? null : Math.round(value * 100)
}

function matchMatrixQuestions(questions: Question[], matrix: QuestionMatrixRow[]) {
  if (matrix.length !== questions.length) {
    throw new Error(`Matriz incompatível: recebi ${matrix.length} itens, mas a planilha de respostas possui ${questions.length} colunas de questão.`)
  }

  const mapped = new Map<string, QuestionMatrixRow>()
  for (const question of questions) {
    const candidates = matrix.filter((item) => item.number === question.number && item.area === question.area)
    if (question.expectedSchoolAccuracy === null) continue
    const matches = candidates.filter((item) => {
      return item.schoolAccuracyFraction !== null && Math.abs(item.schoolAccuracyFraction - question.expectedSchoolAccuracy!) <= 0.006
    })
    if (matches.length !== 1) {
      throw new Error(`Matriz incompatível na questão ${question.id}: o percentual de acerto da escola não confirma um vínculo único com a planilha de respostas.`)
    }
    mapped.set(question.id, matches[0])
  }
  return mapped
}

async function readRows(buffer: ArrayBuffer): Promise<CellRows> {
  const zip = await JSZip.loadAsync(buffer)
  const sheet = zip.file('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('A planilha não possui a primeira aba esperada.')

  const sharedFile = zip.file('xl/sharedStrings.xml')
  const sharedXml = sharedFile ? await sharedFile.async('string') : ''
  const shared = [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join('')),
  )

  const xml = await sheet.async('string')
  const rows: CellRows = new Map()
  for (const rowMatch of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = new Map<string, string>()
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/r="([A-Z]+\d+)"/)?.[1]
      if (!reference) continue
      const type = cellMatch[1].match(/t="([^"]+)"/)?.[1]
      const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
      const inline = cellMatch[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
      const value = type === 's' && raw ? shared[Number(raw)] : inline ?? raw
      if (value !== undefined) row.set(columnFromReference(reference), decodeXml(value))
    }
    rows.set(Number(rowMatch[1]), row)
  }
  return rows
}

export async function parseEnemSaeWorkbook(buffer: ArrayBuffer, questionMatrixBuffer: ArrayBuffer): Promise<EnemSaeAnalysis> {
  const rows = await readRows(buffer)
  const header = rows.get(1)
  const labels = rows.get(2)
  if (!header || !labels || normalize(labels.get('A')) !== 'nome') {
    throw new Error('Modelo inválido: espero a aba com Nome na célula A2 e itens na linha 1.')
  }

  const questions = parseQuestions(header, labels)
  if (questions.length !== 185 || ENEM_SAE_AREAS.some((area) => questions.filter((question) => question.area === area).length !== (area === 'LC' ? 50 : 45))) {
    throw new Error('Modelo inválido: espero 50 itens LC e 45 itens em cada uma das áreas CH, CN e MT.')
  }

  const matrix = await parseQuestionMatrix(questionMatrixBuffer)
  const questionMetadata = matchMatrixQuestions(questions, matrix)
  const questionTotals = new Map(questions.map((question) => [question.id, { correct: 0, answered: 0 }]))
  const areaTotals = Object.fromEntries(ENEM_SAE_AREAS.map((area) => [area, { correct: 0, answered: 0 }])) as Record<EnemSaeArea, { correct: number; answered: number }>
  const students: EnemSaeStudent[] = []

  for (const [rowNumber, row] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    if (rowNumber < 3) continue
    const name = row.get('A')?.trim()
    if (!name) continue

    const totals = { correct: 0, answered: 0 }
    const answers: Record<string, boolean | null> = {}
    const byArea = Object.fromEntries(ENEM_SAE_AREAS.map((area) => [area, { correct: 0, answered: 0 }])) as Record<EnemSaeArea, { correct: number; answered: number }>
    for (const question of questions) {
      const answer = normalize(row.get(question.column))
      if (answer !== 'acerto' && answer !== 'erro') {
        answers[question.id] = null
        continue
      }
      const correct = answer === 'acerto'
      answers[question.id] = correct
      totals.answered++
      byArea[question.area].answered++
      areaTotals[question.area].answered++
      questionTotals.get(question.id)!.answered++
      if (correct) {
        totals.correct++
        byArea[question.area].correct++
        areaTotals[question.area].correct++
        questionTotals.get(question.id)!.correct++
      }
    }
    students.push({
      name,
      overallPercent: percent(totals.correct, totals.answered),
      correct: totals.correct,
      answered: totals.answered,
      areas: Object.fromEntries(ENEM_SAE_AREAS.map((area) => [area, percent(byArea[area].correct, byArea[area].answered)])) as StudentAreaPercent,
      answers,
    })
  }

  if (students.length === 0) throw new Error('Nenhuma linha de aluno com respostas acerto/erro foi encontrada.')
  const correct = students.reduce((sum, student) => sum + student.correct, 0)
  const answered = students.reduce((sum, student) => sum + student.answered, 0)
  return {
    students,
    areas: Object.fromEntries(ENEM_SAE_AREAS.map((area) => [area, { ...areaTotals[area], accuracyPercent: percent(areaTotals[area].correct, areaTotals[area].answered) }])) as EnemSaeAnalysis['areas'],
    questions: questions.map((question) => {
      const metadata = questionMetadata.get(question.id)
      const { nationalAccuracyFraction: _nationalAccuracyFraction, schoolAccuracyFraction: _schoolAccuracyFraction, schoolDifferenceFraction: _schoolDifferenceFraction, ...displayMetadata } = metadata ?? {}
      return {
        id: question.id,
        number: question.number,
        area: question.area,
        ...questionTotals.get(question.id)!,
        accuracyPercent: percent(questionTotals.get(question.id)!.correct, questionTotals.get(question.id)!.answered),
        ...displayMetadata,
      }
    }),
    summary: { studentCount: students.length, answeredItems: answered, overallPercent: percent(correct, answered), belowReferenceCount: students.filter((student) => (student.overallPercent ?? 0) < 60).length },
  }
}

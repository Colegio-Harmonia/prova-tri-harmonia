// Confere se uma turma do Classroom parece ser a turma certa para uma prova,
// só pelo nome/seção da turma. O seletor de turma lista TODAS as turmas em que
// o professor leciona — inclusive as de outra disciplina da mesma série (ex.:
// professora polivalente que também está na turma de Artes). Em 25/11/2026
// duas provas de Ciências do 3º ano foram vinculadas às turmas de Artes e as
// notas foram lançadas lá. A checagem é heurística e serve só para AVISAR e
// ordenar o seletor; nunca bloqueia, porque o nome da turma é livre no
// Classroom.

export type CourseForFit = { name: string; section?: string | null }
export type ExamForFit = { subject: string; gradeYear: number | null }

export type CourseExamFit =
  | { kind: 'match' }
  | { kind: 'unknown' }
  | { kind: 'mismatch'; reasons: string[] }

type SubjectDef = { key: string; label: string; aliases: string[] }

// Aliases já normalizados (sem acento, minúsculos). A ordem não importa: a
// busca sempre tenta os aliases mais longos primeiro, para que "educacao
// fisica" não seja lido também como "fisica".
const SUBJECTS: SubjectDef[] = [
  { key: 'artes', label: 'Artes', aliases: ['artes', 'arte'] },
  { key: 'ciencias', label: 'Ciências', aliases: ['ciencias', 'ciencia', 'ciencias da natureza'] },
  { key: 'educacao-fisica', label: 'Educação Física', aliases: ['educacao fisica', 'ed fisica'] },
  { key: 'filosofia', label: 'Filosofia', aliases: ['filosofia'] },
  { key: 'geografia', label: 'Geografia', aliases: ['geografia'] },
  { key: 'historia', label: 'História', aliases: ['historia'] },
  { key: 'ingles', label: 'Inglês', aliases: ['ingles', 'lingua inglesa'] },
  { key: 'espanhol', label: 'Espanhol', aliases: ['espanhol', 'lingua espanhola'] },
  { key: 'matematica', label: 'Matemática', aliases: ['matematica'] },
  { key: 'portugues', label: 'Língua Portuguesa', aliases: ['portugues', 'lingua portuguesa'] },
  { key: 'literatura', label: 'Literatura', aliases: ['literatura'] },
  { key: 'redacao', label: 'Redação', aliases: ['redacao'] },
  { key: 'biologia', label: 'Biologia', aliases: ['biologia'] },
  { key: 'fisica', label: 'Física', aliases: ['fisica'] },
  { key: 'quimica', label: 'Química', aliases: ['quimica'] },
  { key: 'sociologia', label: 'Sociologia', aliases: ['sociologia'] },
]

const ALIASES = SUBJECTS
  .flatMap((subject) => subject.aliases.map((alias) => ({ alias, subject })))
  .sort((a, b) => b.alias.length - a.alias.length)

export function normalizeForFit(text: string): string {
  return text
    .normalize('NFKD') // "º"/"ª" viram "o"/"a"; acentos viram marcas combinantes
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function subjectsIn(text: string): SubjectDef[] {
  let rest = ` ${normalizeForFit(text)} `
  const found = new Map<string, SubjectDef>()
  for (const { alias, subject } of ALIASES) {
    const needle = ` ${alias} `
    if (!rest.includes(needle)) continue
    found.set(subject.key, subject)
    rest = rest.split(needle).join('  ')
  }
  return [...found.values()]
}

function subjectOfExam(subject: string): SubjectDef {
  const [known] = subjectsIn(subject)
  if (known) return known
  const key = normalizeForFit(subject)
  return { key, label: subject, aliases: key ? [key] : [] }
}

// "3º Ano B - 26" → 3; "1ª Série" → 1. O "26" do ano letivo não é lido
// porque não vem seguido de "ano"/"série".
export function gradeYearIn(text: string): number | null {
  const match = normalizeForFit(text).match(/\b(\d{1,2})(?:o|a)?\s*(?:anos?|series?)\b/)
  return match ? Number(match[1]) : null
}

export function checkCourseExamFit(course: CourseForFit, exam: ExamForFit): CourseExamFit {
  const text = `${course.name} ${course.section ?? ''}`
  const examSubject = subjectOfExam(exam.subject)
  const courseSubjects = subjectsIn(text)
  const courseYear = gradeYearIn(text)

  const reasons: string[] = []
  const subjectMatches = courseSubjects.some((subject) => subject.key === examSubject.key)
  if (courseSubjects.length > 0 && !subjectMatches) {
    const labels = courseSubjects.map((subject) => subject.label).join('/')
    reasons.push(`a turma parece ser de ${labels}, e a prova é de ${exam.subject}`)
  }
  if (courseYear !== null && exam.gradeYear !== null && courseYear !== exam.gradeYear) {
    reasons.push(`a turma parece ser do ${courseYear}º ano/série, e a prova é do ${exam.gradeYear}º ano/série`)
  }

  if (reasons.length > 0) return { kind: 'mismatch', reasons }
  if (subjectMatches) return { kind: 'match' }
  return { kind: 'unknown' }
}

const FIT_RANK: Record<CourseExamFit['kind'], number> = { match: 0, unknown: 1, mismatch: 2 }

// Turmas compatíveis primeiro, depois as que não dá para julgar pelo nome e
// por último as que parecem ser de outra disciplina/série. Mantém a ordem
// original dentro de cada grupo.
export function sortCoursesForExam<T extends CourseForFit>(courses: T[], exam: ExamForFit): T[] {
  return courses
    .map((course, index) => ({ course, index, rank: FIT_RANK[checkCourseExamFit(course, exam).kind] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ course }) => course)
}

export function describeMismatch(fit: CourseExamFit): string | null {
  if (fit.kind !== 'mismatch') return null
  const text = fit.reasons.join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function courseLabel(course: CourseForFit): string {
  return `${course.name}${course.section ? ` — ${course.section}` : ''}`
}

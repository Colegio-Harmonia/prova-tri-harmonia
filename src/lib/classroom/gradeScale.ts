export const CLASSROOM_MAX_POINTS = 100

/** Converte a nota interna de 0–10 para a escala de 0–100 do Classroom. */
export function gradeOnClassroomScale(gradeOnTen: number): number {
  const bounded = Math.min(10, Math.max(0, gradeOnTen))
  return Math.round(bounded * 10 * 10) / 10
}

type ActivityWorkflowExam = {
  examKind: string
  status: string
  createdBy: number
}

// Toda atividade pertence ao professor que a criou. Ela não entra na fila de
// distribuição e aprovação das provas formais: o próprio criador revisa o
// conteúdo, gera os documentos e registra a aplicação.
export function isSelfManagedActivity(exam: Pick<ActivityWorkflowExam, 'examKind'>) {
  return exam.examKind === 'reforco_enem' || exam.examKind === 'atividade'
}

export function canManageOwnActivity(
  exam: ActivityWorkflowExam,
  currentUserId: number | null,
  isStaff: boolean,
) {
  return isSelfManagedActivity(exam) && (isStaff || (currentUserId !== null && exam.createdBy === currentUserId))
}

export function canFinalizeOwnActivity(
  exam: ActivityWorkflowExam,
  currentUserId: number | null,
  isStaff: boolean,
) {
  return exam.status === 'rascunho' && canManageOwnActivity(exam, currentUserId, isStaff)
}

export function canMarkOwnActivityApplied(
  exam: ActivityWorkflowExam,
  currentUserId: number | null,
  isStaff: boolean,
) {
  return exam.status === 'aprovado' && canManageOwnActivity(exam, currentUserId, isStaff)
}

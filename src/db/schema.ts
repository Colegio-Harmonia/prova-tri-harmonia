import { sql } from 'drizzle-orm'
import { pgTable, serial, text, boolean, timestamp, integer, jsonb, varchar, smallint, real, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  // Nullable (16/07/2026): login por senha convive com login Google OAuth
  // institucional — uma conta pode ter só um dos dois, ou os dois. Nunca
  // exigir os dois nem migrar contas existentes.
  passwordHash: text('password_hash'),
  // ID da conta Google (`sub` do provider) — preenchido no primeiro login
  // via OAuth, não no cadastro. Aluno NÃO entra nessa tabela (não loga na
  // plataforma; é listado via Classroom API só na hora de lançar nota).
  googleId: text('google_id').unique(),
  // 'direcao' adicionado 17/07/2026 — mesma permissão de superusuário que
  // 'coordenacao' em todo o sistema, ver isStaffSuperuser() em
  // src/lib/auth/roles.ts. `role` é `text` puro (sem CHECK constraint no
  // Postgres, confirmado — o enum aqui é só tipagem do Drizzle/TS), então
  // adicionar um valor novo não precisa de migration nenhuma.
  role: text('role', { enum: ['coordenacao', 'professor', 'direcao'] }).notNull().default('professor'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
})

// Uma instalação é a conversa direta entre um usuário e o app Prova-tri no
// Google Chat. Ela só é vinculada depois que a própria pessoa confirma a
// conta na plataforma; nunca inferimos e-mail pelo evento do Chat.
export const googleChatInstallations = pgTable('google_chat_installations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).unique(),
  chatUserId: text('chat_user_id').notNull().unique(),
  spaceName: text('space_name').notNull().unique(),
  connectTokenHash: text('connect_token_hash').notNull().unique(),
  connectTokenExpiresAt: timestamp('connect_token_expires_at').notNull(),
  active: boolean('active').notNull().default(true),
  connectedAt: timestamp('connected_at'),
  removedAt: timestamp('removed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  activeUserIndex: index('google_chat_installations_active_user_idx').on(table.userId, table.active),
}))

export const administrativeAudit = pgTable('administrative_audit', {
  id: serial('id').primaryKey(),
  action: text('action').notNull(),
  actorId: integer('actor_id').references(() => users.id).notNull(),
  // Uma exclusão administrativa preserva a trilha de auditoria, mas torna o
  // usuário-alvo inexistente. O nome e os dados anteriores ficam no JSON de
  // auditoria e a referência é anulada pelo banco.
  targetUserId: integer('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  previousValue: jsonb('previous_value'),
  nextValue: jsonb('next_value'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  createdAtIndex: index('administrative_audit_created_at_idx').on(table.createdAt),
  targetUserIndex: index('administrative_audit_target_user_idx').on(table.targetUserId),
}))

// Telemetria operacional de IA: deliberadamente não guarda prompt, resposta
// bruta, nome de aluno ou identificadores de correção. Serve para acompanhar
// custo, falhas e reparos sem criar um novo repositório de conteúdo sensível.
export const aiOperations = pgTable('ai_operations', {
  id: serial('id').primaryKey(),
  operation: text('operation').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['succeeded', 'rejected', 'failed'] }).notNull(),
  attempt: smallint('attempt').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  durationMs: integer('duration_ms'),
  errorCode: text('error_code'),
  modelProfileId: integer('model_profile_id'),
  estimatedCostMicrousd: integer('estimated_cost_microusd'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  operationCreatedAtIndex: index('ai_operations_operation_created_at_idx').on(table.operation, table.createdAt),
  statusCreatedAtIndex: index('ai_operations_status_created_at_idx').on(table.status, table.createdAt),
}))

// Reset administrativo do contador diário. Não apaga telemetria: apenas
// define de quando em diante uma finalidade volta a consumir a cota.
export const aiBudgetResets = pgTable('ai_budget_resets', {
  id: serial('id').primaryKey(),
  purpose: text('purpose', { enum: ['text_generation', 'image_generation', 'image_validation', 'scan_transcription'] }),
  resetBy: integer('reset_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  purposeCreatedAtIndex: index('ai_budget_resets_purpose_created_at_idx').on(table.purpose, table.createdAt),
}))

// Perfis de execução editáveis somente pela gestão. Preços são snapshots de
// contrato, nunca segredo; chaves continuam exclusivamente em variáveis do servidor.
export const aiModelProfiles = pgTable('ai_model_profiles', {
  id: serial('id').primaryKey(),
  purpose: text('purpose', { enum: ['text_generation', 'image_generation', 'image_validation', 'scan_transcription'] }).notNull(),
  provider: text('provider', { enum: ['deepseek', 'gemini', 'anthropic', 'openai'] }).notNull(),
  model: text('model').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  inputCostMicrousdPerMillion: integer('input_cost_microusd_per_million'),
  outputCostMicrousdPerMillion: integer('output_cost_microusd_per_million'),
  imageCostMicrousd: integer('image_cost_microusd'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  purposeEnabledIndex: index('ai_model_profiles_purpose_enabled_idx').on(table.purpose, table.enabled),
}))

// Fluxo (confirmado 2026-07-14, revisao_concluida adicionado 17/07/2026):
// rascunho (IA gerou) -> atribuido (coordenação atribui a um revisor,
// dispara Google Chat) -> em_andamento (o atribuído começou a revisar) ->
// revisao_concluida (o atribuído avisa que terminou, dispara Google Chat
// pra coordenação/direção — existe como status próprio porque sem isso o
// painel continuava mostrando "Em andamento" mesmo depois do professor
// terminar, sem sinalizar visualmente que já está pronto pra aprovação) ->
// aprovado (aprovação dispara a geração dos 3 documentos) -> impresso ->
// aplicado (professor aplicou em sala) -> corrigido (professor terminou de
// corrigir — só a marcação por enquanto, sem lançamento de nota/acerto
// ainda). atribuir/aprovar/marcar_impresso são coordenação-only;
// iniciar_revisao/concluir_revisao/marcar_aplicado/marcar_corrigido podem
// ser feitos pelo próprio atribuído OU coordenação.
// Provas formais: atribuído -> em_revisao -> aprovado -> impresso ->
// aplicado -> parcialmente_corrigida/corrigido. Os estados antigos ficam
// aceitos para ler históricos durante a migração, sem alterar documentos,
// cartões-resposta ou scans já existentes.
export const EXAM_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao', 'aprovado', 'impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido'] as const

// Rótulo pedagógico da prova. A escala de correção NÃO vem deste rótulo:
// TRI INEP é decidida pela presença de itens reais do banco ENEM e pela
// calibração oficial disponível para eles. O painel SAE externo não cria
// generated_exams e não participa desta enumeração.
// Natureza do registro (Módulo 3, migration 0017): 'prova' é o fluxo
// clássico; 'reforco_enem' é atividade de reforço por habilidade INEP
// (EM, banco ENEM, sem nota — os 3 documentos viram Atividade/Gabarito
// Comentado/Mapa da Atividade). Mesma tabela de propósito: herda revisão,
// aprovação, docs, autorização e /status sem duplicar pipeline.
export const EXAM_KINDS = ['prova', 'reforco_enem', 'atividade'] as const
export type ExamKind = (typeof EXAM_KINDS)[number]

export const ASSESSMENT_KINDS = ['padrao', 'enem'] as const
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number]
export const SCORING_METHODS = ['percentual', 'tri'] as const
export type ScoringMethod = (typeof SCORING_METHODS)[number]

export const generatedExams = pgTable('generated_exams', {
  id: serial('id').primaryKey(),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  segment: text('segment', { enum: ['anos-iniciais', 'anos-finais', 'ensino-medio'] }).notNull(),
  gradeYear: integer('grade_year').notNull(),
  // Ano letivo (2026, 2027...) — distinto de gradeYear (série/ano escolar,
  // ex: 3º ano). Permite reaproveitar o sistema ano após ano sem confundir
  // provas de anos letivos diferentes na mesma série.
  academicYear: integer('academic_year').notNull(),
  subject: text('subject').notNull(),
  bimester: integer('bimester'),
  questionCount: integer('question_count').notNull(),
  objectiveCount: integer('objective_count').notNull(),
  discursiveCount: integer('discursive_count').notNull(),
  // IDs de imported_questions escolhidos manualmente na tela de geração
  // (Ensino Médio) — guardado à parte de questionCount pra "Regenerar"
  // saber quantas questões pedir de novo pra IA e reanexar exatamente as
  // mesmas questões do banco, sem re-sortear a escolha do usuário.
  enemBankQuestionIds: integer('enem_bank_question_ids').array(),
  examKind: text('exam_kind', { enum: EXAM_KINDS }).notNull().default('prova'),
  assessmentKind: text('assessment_kind', { enum: ASSESSMENT_KINDS }).notNull().default('padrao'),
  scoringMethod: text('scoring_method', { enum: SCORING_METHODS }).notNull().default('percentual'),
  status: text('status', { enum: EXAM_STATUSES }).notNull().default('rascunho'),
  generationPayload: jsonb('generation_payload').notNull(),
  unmappedWarnings: jsonb('unmapped_warnings'),
  driveFolderId: text('drive_folder_id'),
  provaDocId: text('prova_doc_id'),
  provaDocUrl: text('prova_doc_url'),
  gabaritoDocId: text('gabarito_doc_id'),
  gabaritoDocUrl: text('gabarito_doc_url'),
  mapaDocId: text('mapa_doc_id'),
  mapaDocUrl: text('mapa_doc_url'),
  // Atribuição pra revisão — usuário existente da tabela `users` por enquanto
  // (já tem e-mail real da escola); quando o OAuth do Google for integrado,
  // esse mesmo registro passa a ter login Google vinculado, sem migração.
  assignedTo: integer('assigned_to').references(() => users.id),
  assignedBy: integer('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at'),
  chatNotifiedAt: timestamp('chat_notified_at'),
  reviewedAt: timestamp('reviewed_at'),
  // Preenchido quando o professor atribuído clica em "Avisar coordenação
  // que terminei a revisão" (Gatilho 3, 17/07/2026) — nunca setado
  // automaticamente, é um sinal manual porque não existe transição de
  // status própria pra "terminei de revisar" (só quem aprova é
  // coordenação/direção, revisão em si não tem um "fim" formal no
  // state machine). Guarda quando pra não deixar reenviar o aviso à toa
  // a cada refresh de página.
  reviewReadyNotifiedAt: timestamp('review_ready_notified_at'),
  printedAt: timestamp('printed_at'),
  appliedAt: timestamp('applied_at'),
  correctedAt: timestamp('corrected_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  finalizedAt: timestamp('finalized_at'),
  // Vínculo com a turma do Classroom (Subtarefa 4, 16/07/2026) — setado na
  // tela de correção, não na geração da prova (a prova pode ser gerada
  // antes de decidir/saber em qual turma vai ser aplicada). Habilita
  // importar o roster em vez de cadastrar aluno um por um.
  classroomCourseId: text('classroom_course_id'),
  // ID do CourseWork criado no Classroom pra essa prova (Subtarefa 5,
  // 17/07/2026) — criado uma vez só, na primeira vez que "Lançar notas no
  // Classroom" roda; reaproveitado em cliques seguintes pra não duplicar
  // atividade a cada tentativa.
  classroomCourseWorkId: text('classroom_coursework_id'),
  // Arquivamento operacional compartilhado: quando uma prova é arquivada,
  // ela sai da visão normal de todos os envolvidos e vai para Arquivadas.
  archivedAt: timestamp('archived_at'),
})

// Legado de arquivamento individual. Mantido somente para preservar registros
// históricos; o arquivamento atual vive em generated_exams.archived_at.
export const examUserArchives = pgTable('exam_user_archives', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id, { onDelete: 'cascade' }).notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
}, (table) => ({
  userExamUnique: uniqueIndex('exam_user_archives_user_exam_unique').on(table.userId, table.examId),
  userArchivedAtIndex: index('exam_user_archives_user_archived_at_idx').on(table.userId, table.archivedAt),
}))

// Integração de uma Atividade FI/FII com o Classroom. A correção continua
// acontecendo na interface do Google; aqui só guardamos o vínculo técnico e
// a data da última importação, sem reaproveitar examCorrections (que é o
// fluxo de respostas por questão das provas).
export const activityClassroomSyncs = pgTable('activity_classroom_syncs', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id, { onDelete: 'cascade' }).notNull(),
  courseId: text('course_id').notNull(),
  courseWorkId: text('coursework_id').notNull(),
  formId: text('form_id'),
  rubricId: text('rubric_id'),
  publishedAt: timestamp('published_at').defaultNow().notNull(),
  lastImportedAt: timestamp('last_imported_at'),
  lastImportError: text('last_import_error'),
}, (table) => ({
  examUnique: uniqueIndex('activity_classroom_syncs_exam_unique').on(table.examId),
  courseWorkUnique: uniqueIndex('activity_classroom_syncs_coursework_unique').on(table.courseId, table.courseWorkId),
}))

// Snapshot das notas e dos níveis de rubrica atribuídos pelo professor no
// Classroom. Não inferimos desempenho por habilidade quando o Classroom não
// devolve a rubrica: a análise usa somente esses valores efetivamente lidos.
export const activityClassroomResults = pgTable('activity_classroom_results', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id, { onDelete: 'cascade' }).notNull(),
  classroomStudentId: text('classroom_student_id').notNull(),
  classroomSubmissionId: text('classroom_submission_id').notNull(),
  studentName: text('student_name').notNull(),
  studentEmail: text('student_email'),
  submissionState: text('submission_state'),
  assignedGrade: real('assigned_grade'),
  assignedRubricGrades: jsonb('assigned_rubric_grades'),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  examStudentUnique: uniqueIndex('activity_classroom_results_exam_student_unique').on(table.examId, table.classroomStudentId),
  examImportedIndex: index('activity_classroom_results_exam_imported_idx').on(table.examId, table.importedAt),
}))

// Correção por aluno (Subtarefa 4, 16/07/2026) — 1 linha por (prova, aluno).
// Aluno é texto livre (nome/e-mail), NÃO uma FK pra `users` — decisão já
// confirmada no login Google: aluno nunca tem conta na plataforma.
// `classroomStudentId` (userId opaco do Classroom) só é preenchido quando
// o aluno veio de "Importar alunos da turma" — nulo em entrada manual, e
// vai ser necessário na Subtarefa 5 (devolução de nota, studentSubmissions
// são endereçadas por esse id, não por e-mail).
// `answers` segue o mesmo padrão de `generation_payload`: array JSONB por
// questão, não normalizado em linhas — ver pendência #7 do
// docs/MVP_GERACAO_PROVAS.md sobre esse padrão já estabelecido no projeto.
export const examCorrections = pgTable('exam_corrections', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id).notNull(),
  classroomStudentId: text('classroom_student_id'),
  studentName: text('student_name').notNull(),
  studentEmail: text('student_email'),
  answers: jsonb('answers').notNull(),
  status: text('status', { enum: ['pendente', 'revisado'] }).notNull().default('pendente'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
  // Preenchido quando a nota desse aluno foi devolvida de verdade pro
  // Classroom (Subtarefa 5) — não impede reenvio (patch+return são
  // idempotentes na API do Google), só serve pra UI mostrar o que já foi
  // lançado antes.
  gradeReturnedAt: timestamp('grade_returned_at'),
  // Resultado da pontuação (Subtarefa 2, migration 0016) — gravado pelo
  // job 'pontuar_prova' quando a correção fica 'revisado', na escala do
  // scoring_method da prova. Shape em src/lib/scoring/scoringPolicy.ts.
  scoreResult: jsonb('score_result'),
})

// Uma atribuição congela quem receberá uma folha antes da aplicação. Ela é
// separada de `examCorrections` porque a correção aprovada só existe depois
// da conferência docente, enquanto a identidade impressa precisa existir
// antes. `pronta` ainda não tem QR/token emitido; `emitida` só é alcançada
// pelo emissor que assina o QR. Reimpressão anula a emissão anterior e cria
// outra linha, preservando a rastreabilidade.
export const SHEET_ASSIGNMENT_STATUSES = ['pronta', 'emitida', 'anulada'] as const

export const examSheetAssignments = pgTable('exam_sheet_assignments', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id).notNull(),
  examCorrectionId: integer('exam_correction_id').references(() => examCorrections.id).notNull(),
  classroomStudentId: text('classroom_student_id').notNull(),
  studentNameSnapshot: text('student_name_snapshot').notNull(),
  studentEmailSnapshot: text('student_email_snapshot'),
  // Identificador aleatório, sem PII e sem ser o ID sequencial da prova ou
  // da correção. A assinatura do QR será derivada dele no momento da emissão.
  publicId: text('public_id').notNull(),
  // Só é preenchido quando a folha ganha um QR assinado. Não guardar token
  // legível evita que o banco seja suficiente para reproduzir uma emissão.
  tokenDigest: text('token_digest'),
  layoutVersion: text('layout_version').notNull().default('PTR1'),
  pageCount: smallint('page_count').notNull().default(2),
  status: text('status', { enum: SHEET_ASSIGNMENT_STATUSES }).notNull().default('pronta'),
  // Quem congelou o roster pode ser diferente de quem fez o download/emitou
  // o lote; ambos ficam registrados para a futura auditoria de scan.
  issuedBy: integer('issued_by').references(() => users.id).notNull(),
  emittedAt: timestamp('emitted_at'),
  emittedBy: integer('emitted_by').references(() => users.id),
  voidedAt: timestamp('voided_at'),
  voidedBy: integer('voided_by').references(() => users.id),
  reprintOfId: integer('reprint_of_id').references((): AnyPgColumn => examSheetAssignments.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  publicIdUnique: uniqueIndex('exam_sheet_assignments_public_id_unique').on(table.publicId),
  tokenDigestUnique: uniqueIndex('exam_sheet_assignments_token_digest_unique').on(table.tokenDigest),
  activeStudentAssignmentUnique: uniqueIndex('exam_sheet_assignments_active_student_unique')
    .on(table.examId, table.classroomStudentId)
    .where(sql`${table.status} IN ('pronta', 'emitida')`),
  correctionIndex: index('exam_sheet_assignments_correction_idx').on(table.examCorrectionId),
  examStatusIndex: index('exam_sheet_assignments_exam_status_idx').on(table.examId, table.status),
}))

// Arquivo bruto recebido do scanner. Ele não compartilha o fluxo de imagens
// pedagógicas: staging e Drive são privados, e nenhuma URL de preview é
// persistida. A leitura por página/OMR virá em tabelas próprias, depois que o
// upload estiver arquivado e autenticado.
export const EXAM_SCAN_UPLOAD_STATUSES = ['staged', 'archived', 'archive_failed', 'expired'] as const

export const examScanUploads = pgTable('exam_scan_uploads', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id).notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  // Chave opaca para um arquivo fora do diretório público; nunca retornar
  // caminho absoluto ao browser, n8n ou log de telemetria.
  stagingObjectKey: text('staging_object_key'),
  status: text('status', { enum: EXAM_SCAN_UPLOAD_STATUSES }).notNull().default('staged'),
  driveFileId: text('drive_file_id'),
  driveVerifiedSha256: text('drive_verified_sha256'),
  archivedAt: timestamp('archived_at'),
  archiveErrorCode: text('archive_error_code'),
  technicalMetadata: jsonb('technical_metadata'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  sha256Index: index('exam_scan_uploads_sha256_idx').on(table.sha256),
  examStatusIndex: index('exam_scan_uploads_exam_status_idx').on(table.examId, table.status),
  driveFileUnique: uniqueIndex('exam_scan_uploads_drive_file_unique').on(table.driveFileId),
}))

// Auditoria sem bytes de arquivo, QR, transcrição ou URL. O detalhe técnico
// é estritamente operacional para poder explicar upload/arquivo/expurgo.
export const examScanAuditEvents = pgTable('exam_scan_audit_events', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id).notNull(),
  uploadId: integer('upload_id').references(() => examScanUploads.id),
  action: text('action').notNull(),
  actorId: integer('actor_id').references(() => users.id),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uploadCreatedAtIndex: index('exam_scan_audit_events_upload_created_at_idx').on(table.uploadId, table.createdAt),
  examCreatedAtIndex: index('exam_scan_audit_events_exam_created_at_idx').on(table.examId, table.createdAt),
}))

// Página lógica do arquivo original. Para PDF, a separação física/canônica é
// responsabilidade do worker; registrar os índices antes do despacho torna o
// retorno do n8n idempotente sem duplicar a imagem bruta no banco.
export const EXAM_SCAN_PAGE_STATUSES = ['pending', 'queued', 'processing', 'needs_review', 'processed', 'failed'] as const

export const examScanPages = pgTable('exam_scan_pages', {
  id: serial('id').primaryKey(),
  uploadId: integer('upload_id').references(() => examScanUploads.id).notNull(),
  pageIndex: smallint('page_index').notNull(),
  sheetAssignmentId: integer('sheet_assignment_id').references(() => examSheetAssignments.id),
  sheetPageNumber: smallint('sheet_page_number'),
  pageType: text('page_type', { enum: ['objective', 'discursive'] }),
  qrTokenDigest: text('qr_token_digest'),
  qualityScore: real('quality_score'),
  canonicalDriveFileId: text('canonical_drive_file_id'),
  canonicalVerifiedSha256: text('canonical_verified_sha256'),
  canonicalMimeType: text('canonical_mime_type'),
  canonicalStagingObjectKey: text('canonical_staging_object_key'),
  canonicalArchivedAt: timestamp('canonical_archived_at'),
  canonicalArchiveErrorCode: text('canonical_archive_error_code'),
  status: text('status', { enum: EXAM_SCAN_PAGE_STATUSES }).notNull().default('pending'),
  exceptionCode: text('exception_code'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  uploadPageUnique: uniqueIndex('exam_scan_pages_upload_page_unique').on(table.uploadId, table.pageIndex),
  uploadStatusIndex: index('exam_scan_pages_upload_status_idx').on(table.uploadId, table.status),
  assignmentIndex: index('exam_scan_pages_assignment_idx').on(table.sheetAssignmentId),
  canonicalDriveFileUnique: uniqueIndex('exam_scan_pages_canonical_drive_file_unique').on(table.canonicalDriveFileId),
}))

// Tentativa de despacho para o n8n, isolada por upload e com número monotônico
// para que retry não duplique as páginas nem confunda callback de execução.
export const EXAM_SCAN_PROCESSING_ATTEMPT_STATUSES = ['queued', 'delivered', 'delivery_failed', 'completed'] as const

export const examScanProcessingAttempts = pgTable('exam_scan_processing_attempts', {
  id: serial('id').primaryKey(),
  uploadId: integer('upload_id').references(() => examScanUploads.id).notNull(),
  attemptNumber: smallint('attempt_number').notNull(),
  status: text('status', { enum: EXAM_SCAN_PROCESSING_ATTEMPT_STATUSES }).notNull().default('queued'),
  requestedBy: integer('requested_by').references(() => users.id).notNull(),
  deliveredAt: timestamp('delivered_at'),
  deliveryErrorCode: text('delivery_error_code'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  uploadAttemptUnique: uniqueIndex('exam_scan_processing_attempts_upload_attempt_unique').on(table.uploadId, table.attemptNumber),
  uploadStatusIndex: index('exam_scan_processing_attempts_upload_status_idx').on(table.uploadId, table.status),
}))

// Resultado sugerido pelo worker, sempre separado da resposta final de
// exam_corrections. A aprovação docente copiará apenas o que for confirmado.
export const EXAM_SCAN_READING_REVIEW_STATUSES = ['pending', 'accepted', 'rejected'] as const

export const examScanReadings = pgTable('exam_scan_readings', {
  id: serial('id').primaryKey(),
  pageId: integer('page_id').references(() => examScanPages.id).notNull(),
  questionNumber: smallint('question_number').notNull(),
  kind: text('kind', { enum: ['objective', 'discursive'] }).notNull(),
  suggestedLetter: text('suggested_letter'),
  suggestedTranscription: text('suggested_transcription'),
  confirmedLetter: text('confirmed_letter'),
  confirmedTranscription: text('confirmed_transcription'),
  confidence: real('confidence'),
  exceptionCode: text('exception_code'),
  modelReference: text('model_reference'),
  cropDriveFileId: text('crop_drive_file_id'),
  cropVerifiedSha256: text('crop_verified_sha256'),
  cropMimeType: text('crop_mime_type'),
  cropStagingObjectKey: text('crop_staging_object_key'),
  cropArchivedAt: timestamp('crop_archived_at'),
  cropArchiveErrorCode: text('crop_archive_error_code'),
  reviewStatus: text('review_status', { enum: EXAM_SCAN_READING_REVIEW_STATUSES }).notNull().default('pending'),
  reviewedBy: integer('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  pageQuestionUnique: uniqueIndex('exam_scan_readings_page_question_unique').on(table.pageId, table.questionNumber),
  pageReviewIndex: index('exam_scan_readings_page_review_idx').on(table.pageId, table.reviewStatus),
  cropDriveFileUnique: uniqueIndex('exam_scan_readings_crop_drive_file_unique').on(table.cropDriveFileId),
  reviewedByIndex: index('exam_scan_readings_reviewed_by_idx').on(table.reviewedBy, table.reviewedAt),
}))

// Snapshot normalizado do diagnóstico SAE importado. O XLSX não é guardado:
// apenas o resultado estruturado já validado e necessário ao painel.
export const enemSaeImports = pgTable('enem_sae_imports', {
  id: serial('id').primaryKey(),
  academicYear: integer('academic_year').notNull(),
  gradeYear: smallint('grade_year').notNull().default(3),
  bimester: smallint('bimester').notNull(),
  analysis: jsonb('analysis').notNull(),
  importedBy: integer('imported_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  periodUnique: uniqueIndex('enem_sae_imports_period_unique').on(table.academicYear, table.gradeYear, table.bimester),
  academicYearIndex: index('enem_sae_imports_academic_year_idx').on(table.academicYear),
}))

// Escape hatch for real Google Sheets tab names diverging from the discipline
// name (confirmed, e.g. "2° Mat", "6° Cie" inside the 2º-ano file) — lets
// coordenação correct a mismatch without a code deploy.
export const curriculumTabOverrides = pgTable('curriculum_tab_overrides', {
  id: serial('id').primaryKey(),
  segment: text('segment').notNull(),
  gradeYear: integer('grade_year').notNull(),
  subject: text('subject').notNull(),
  sheetTabName: text('sheet_tab_name').notNull(),
  updatedBy: integer('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Conteúdo enriquecido extraído da Programação Trimestral e Manuais do Professor
// para tornar as questões geradas pela IA mais fiéis ao material didático real.
export const curriculumEnrichment = pgTable('curriculum_enrichment', {
  id: serial('id').primaryKey(),
  segment: text('segment').notNull(),
  gradeYear: integer('grade_year').notNull(),
  subject: text('subject').notNull(),
  chapterTitle: text('chapter_title').notNull(),
  bimester: integer('bimester'),
  enrichedContent: text('enriched_content'),
  detailedObjectives: text('detailed_objectives'),
  pedagogicalNotes: text('pedagogical_notes'),
  source: text('source').default('programacao_trimestral'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ═══════════════════════════════════════════════════════════════════
// Motor de Classificações Pedagógicas
// ═══════════════════════════════════════════════════════════════════

export const CLASSIFIABLE_TYPES = [
  'imported_question',
  'generated_exam_question',
  'exam_correction_answer',
] as const

export const CLASSIFICATION_SOURCES = [
  'AI',
  'TEACHER',
  'PEDAGOGICAL_REVIEW',
  'ENEM_IMPORT',
  'MANUAL_IMPORT',
  'SYSTEM_RULE',
  'OFFICIAL_SOURCE',
] as const

export const CLASSIFICATION_STATUSES = [
  'sugerida',
  'em_revisao',
  'aprovada',
  'rejeitada',
  'substituida',
  'desatualizada',
] as const

export const CLASSIFICATION_AUDIT_ACTIONS = [
  'created',
  'approved',
  'rejected',
  'edited',
  'superseded',
  'outdated',
] as const

export const pedagogicalTaxonomies = pgTable('pedagogical_taxonomies', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  manualVersion: text('manual_version').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
})

export const pedagogicalCategories = pgTable('pedagogical_categories', {
  id: serial('id').primaryKey(),
  taxonomyId: integer('taxonomy_id').references(() => pedagogicalTaxonomies.id).notNull(),
  code: varchar('code', { length: 32 }).notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  order: smallint('order').notNull(),
  metadata: jsonb('metadata'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  uqTaxonomyCode: uniqueIndex('pedagogical_categories_taxonomy_code_unique').on(table.taxonomyId, table.code),
}))

export const pedagogicalClassifications = pgTable('pedagogical_classifications', {
  id: serial('id').primaryKey(),
  classifiableType: text('classifiable_type', { enum: CLASSIFIABLE_TYPES }).notNull(),
  classifiableId: integer('classifiable_id').notNull(),
  classifiableSubId: integer('classifiable_sub_id'),
  taxonomyId: integer('taxonomy_id').references(() => pedagogicalTaxonomies.id).notNull(),
  categoryId: integer('category_id').references(() => pedagogicalCategories.id).notNull(),
  classificationCode: varchar('classification_code', { length: 32 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(true),
  confidence: real('confidence'),
  source: text('source', { enum: CLASSIFICATION_SOURCES }).notNull(),
  status: text('status', { enum: CLASSIFICATION_STATUSES }).notNull().default('sugerida'),
  isCurrent: boolean('is_current').notNull().default(true),
  explanation: text('explanation'),
  evidence: text('evidence'),
  manualVersion: text('manual_version'),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  promptVersion: text('prompt_version'),
  version: integer('version').notNull().default(1),
  supersedesId: integer('supersedes_id').references((): AnyPgColumn => pedagogicalClassifications.id),
  createdBy: integer('created_by').references(() => users.id),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
}, (table) => ({
  lookupIdx: index('idx_pedagogical_classifications_lookup')
    .on(table.classifiableType, table.classifiableId, table.classifiableSubId, table.taxonomyId, table.isCurrent),
  uqCurrent: uniqueIndex('uq_pedagogical_current_classification')
    .on(table.classifiableType, table.classifiableId, table.classifiableSubId, table.taxonomyId)
    .where(sql`${table.isCurrent} = true`),
}))

export const pedagogicalClassificationAudit = pgTable('pedagogical_classification_audit', {
  id: serial('id').primaryKey(),
  classificationId: integer('classification_id').references(() => pedagogicalClassifications.id).notNull(),
  action: text('action', { enum: CLASSIFICATION_AUDIT_ACTIONS }).notNull(),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  reason: text('reason'),
  performedBy: integer('performed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ═══════════════════════════════════════════════════════════════════
// ENEM — Matriz de Referência e Classificação de Questões Importadas
// ═══════════════════════════════════════════════════════════════════

/** Áreas de conhecimento do ENEM */
export const enemAreas = pgTable('enem_areas', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: text('name').notNull(),
  order: smallint('order').notNull(),
})

/** Competências por área */
export const enemCompetencies = pgTable('enem_competencies', {
  id: serial('id').primaryKey(),
  areaId: integer('area_id').references(() => enemAreas.id).notNull(),
  number: smallint('number').notNull(),
  description: text('description').notNull(),
})

/** Habilidades (H1-H30 por área) */
export const enemSkills = pgTable('enem_skills', {
  id: serial('id').primaryKey(),
  competencyId: integer('competency_id').references(() => enemCompetencies.id).notNull(),
  code: varchar('code', { length: 8 }).notNull(),
  description: text('description').notNull(),
})

/** Eixos Cognitivos comuns a todas as áreas */
export const enemCognitiveAxes = pgTable('enem_cognitive_axes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 4 }).notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
})

/**
 * Classificação das questões importadas do ENEM.
 * Cada registro liga uma imported_question às classificações
 * de Bloom, competência/habilidade da matriz ENEM, e eixo cognitivo.
 */
export const importedQuestionClassifications = pgTable('imported_question_classifications', {
  id: serial('id').primaryKey(),
  questionId: integer('question_id').notNull(), // FK para imported_questions.id (tabela externa ao drizzle)
  source: varchar('source', { length: 16 }).notNull().default('enem'),

  // Bloom
  bloomLevel: varchar('bloom_level', { length: 16 }),
  bloomLevelSource: varchar('bloom_level_source', { length: 16 }).default('pending'),

  // ENEM Matriz
  enemAreaId: integer('enem_area_id').references(() => enemAreas.id),
  enemCompetencyId: integer('enem_competency_id').references(() => enemCompetencies.id),
  enemSkillId: integer('enem_skill_id').references(() => enemSkills.id),
  enemCognitiveAxisId: integer('enem_cognitive_axis_id').references(() => enemCognitiveAxes.id),
  enemClassificationSource: varchar('enem_classification_source', { length: 16 }).default('pending'),

  // Metadata
  classifiedAt: timestamp('classified_at'),
  classifiedBy: integer('classified_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uqClassification: uniqueIndex('uq_classification').on(table.questionId, table.source),
}))

// ---------------------------------------------------------------------------
// Adaptação Inclusiva (Módulo 4, 24/07/2026 — migration 0018).
// Prova Adaptada é versão DERIVADA de uma prova aprovada (original
// intocada). Perfis de laudo vêm de src/config/adaptationLibraries.ts;
// laudo é dado sensível (LGPD): target_student_label é opcional e nunca
// aparece no documento impresso.
// ---------------------------------------------------------------------------

export const ADAPTATION_PROFILES = ['tea', 'tdah', 'discalculia', 'baixa_visao'] as const
export type AdaptationProfileId = (typeof ADAPTATION_PROFILES)[number]

// gerando (job na fila) -> pronto_revisao (IA terminou + validador de
// equivalência passou; revisão humana lado a lado obrigatória) ->
// aprovado (gera o documento "Prova Adaptada"). erro = falha de IA ou
// validador reprovou (nunca vira documento sem passar pelos dois).
export const ADAPTED_EXAM_STATUSES = ['gerando', 'pronto_revisao', 'aprovado', 'erro'] as const
export type AdaptedExamStatus = (typeof ADAPTED_EXAM_STATUSES)[number]

export const adaptedExams = pgTable('adapted_exams', {
  id: serial('id').primaryKey(),
  examId: integer('exam_id').references(() => generatedExams.id).notNull(),
  adaptationProfiles: text('adaptation_profiles').array().notNull(),
  // { "tea": "1.0", "tdah": "1.0" } — versão da biblioteca aplicada, pra
  // auditoria (o conteúdo das bibliotecas evolui no git).
  libraryVersions: jsonb('library_versions').notNull(),
  targetStudentLabel: text('target_student_label'),
  // Mesmo formato do generation_payload, com os campos adaptados por
  // questão (adaptedStatement etc.) — preenchido pelo job.
  adaptedPayload: jsonb('adapted_payload'),
  status: text('status', { enum: ADAPTED_EXAM_STATUSES }).notNull().default('gerando'),
  validationReport: jsonb('validation_report'),
  errorMessage: text('error_message'),
  provaAdaptadaDocId: text('prova_adaptada_doc_id'),
  provaAdaptadaDocUrl: text('prova_adaptada_doc_url'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  approvedBy: integer('approved_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  approvedAt: timestamp('approved_at'),
}, (table) => ({
  examIdx: index('adapted_exams_exam_idx').on(table.examId),
}))

// ---------------------------------------------------------------------------
// Fila de geração assíncrona (Subtarefa 1a, 24/07/2026 — migration 0015).
// Ver docs/SPEC_EXPANSAO_AVALIACAO_APRENDIZAGEM.md, seção 2.
// Fila genérica por job_type: os módulos de reforço ENEM, adaptação
// inclusiva e pontuação entram como tipos novos aqui, sem infra nova.
// Consumida exclusivamente via src/lib/queue/ (enqueue/claim) — rotas e
// worker nunca fazem UPDATE de status direto na tabela.
// ---------------------------------------------------------------------------

export const GENERATION_JOB_TYPES = ['gerar_prova', 'gerar_reforco_enem', 'gerar_atividade', 'adaptar_prova', 'pontuar_prova', 'transcrever_scan', 'processar_scan'] as const
export type GenerationJobType = (typeof GENERATION_JOB_TYPES)[number]

// pendente -> gerando -> concluido | erro (com retry automático enquanto
// attempts < max_attempts). cancelado só a partir de pendente (ação do
// usuário). Reenfileirar manualmente um 'erro' zera attempts e volta a
// 'pendente'.
export const GENERATION_JOB_STATUSES = ['pendente', 'gerando', 'concluido', 'erro', 'cancelado'] as const
export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number]

// Um batch = um disparo do usuário na tela de geração (turma/ano + N
// disciplinas via checkbox). Geração individual é um batch de 1 job —
// caminho de código único.
export const generationBatches = pgTable('generation_batches', {
  id: serial('id').primaryKey(),
  requestedBy: integer('requested_by').references(() => users.id).notNull(),
  segment: text('segment', { enum: ['anos-iniciais', 'anos-finais', 'ensino-medio'] }).notNull(),
  gradeYear: integer('grade_year').notNull(),
  academicYear: integer('academic_year').notNull(),
  classLabel: text('class_label'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const generationJobs = pgTable('generation_jobs', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').references(() => generationBatches.id),
  jobType: text('job_type', { enum: GENERATION_JOB_TYPES }).notNull(),
  // Input auto-suficiente do job (validado por Zod em src/lib/queue/types.ts
  // na entrada E na saída da fila — o worker revalida antes de executar).
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: GENERATION_JOB_STATUSES }).notNull().default('pendente'),
  priority: integer('priority').notNull().default(5),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(2),
  resultExamId: integer('result_exam_id').references(() => generatedExams.id),
  // Resultado de jobs que não produzem uma prova (pontuação, adaptação) e
  // metadados de conclusão (warnings da geração, contagens).
  resultRef: jsonb('result_ref'),
  errorMessage: text('error_message'),
  requestedBy: integer('requested_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  // Job adiado por cota de IA; a fila o retoma após este instante.
  availableAt: timestamp('available_at'),
}, (table) => ({
  // Índice parcial usado pelo claim do worker (FOR UPDATE SKIP LOCKED).
  pollIdx: index('generation_jobs_poll_idx').on(table.status, table.priority, table.id).where(sql`${table.status} = 'pendente'`),
  requesterIdx: index('generation_jobs_requester_idx').on(table.requestedBy, table.createdAt.desc()),
  batchIdx: index('generation_jobs_batch_idx').on(table.batchId),
}))

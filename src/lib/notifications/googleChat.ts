import { google } from 'googleapis'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { googleChatInstallations, users } from '@/db/schema'

/**
 * Send only to a previously activated, individual Chat app conversation.
 * The app never creates a group space and never falls back to a webhook: a
 * failed or missing activation cannot leak exam data.
 */
async function sendChatDirectMessage(userEmail: string, text: string): Promise<boolean> {
  const keyFile = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY_PATH
  if (!keyFile) {
    console.warn('[googleChat] GOOGLE_CHAT_SERVICE_ACCOUNT_KEY_PATH não configurada; notificação individual não enviada.')
    return false
  }

  try {
    const recipient = await db.query.users.findFirst({ where: eq(users.email, userEmail), columns: { id: true } })
    if (!recipient) return false
    const installation = await db.query.googleChatInstallations.findFirst({
      where: and(eq(googleChatInstallations.userId, recipient.id), eq(googleChatInstallations.active, true)),
      columns: { spaceName: true },
    })
    if (!installation) {
      console.warn(`[googleChat] ${userEmail} ainda não ativou as notificações privadas do Prova-tri.`)
      return false
    }
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    })
    const chat = google.chat({ version: 'v1', auth })
    await chat.spaces.messages.create({
      parent: installation.spaceName,
      requestBody: { text },
    })

    return true
  } catch (err) {
    console.warn(`[googleChat] Falha ao enviar notificação pra ${userEmail}:`, err instanceof Error ? err.message : err)
    return false
  }
}

/** Gatilho 1 (Coordenação → Professor): prova atribuída pra revisão. */
export async function sendChatAssignmentNotification(userEmail: string, examLabel: string, reviewUrl: string): Promise<boolean> {
  return sendChatDirectMessage(userEmail, `📋 Uma prova foi atribuída a você para revisão: *${examLabel}*\n${reviewUrl}`)
}

/**
 * Gatilho 2 (Professor → Coordenação/Direção, Subtarefa 8, 17/07/2026):
 * professor lançou as notas no Classroom. Manda uma mensagem para a conversa
 * privada previamente ativada por cada coordenação/direção destinatária.
 */
export async function sendChatGradesReturnedNotification(
  recipientEmails: string[],
  professorName: string,
  examLabel: string,
): Promise<{ sent: number; failed: number }> {
  const text = `✅ ${professorName} finalizou a correção e lançou as notas de: *${examLabel}*`
  const results = await Promise.all(recipientEmails.map((email) => sendChatDirectMessage(email, text)))
  return { sent: results.filter(Boolean).length, failed: results.filter((r) => !r).length }
}

/**
 * Gatilho 3 (Professor → Coordenação/Direção, 17/07/2026): professor clica
 * em "Avisar coordenação que terminei a revisão" — sinal manual, não
 * existe transição de status própria pra "terminei de revisar" (só
 * coordenação/direção aprova, a revisão em si não tem um "fim" formal no
 * state machine). Descoberto como lacuna real numa conversa com o
 * usuário: sem isso, coordenação só sabia que uma revisão terminou
 * checando /status manualmente.
 */
export async function sendChatReviewReadyNotification(
  recipientEmails: string[],
  professorName: string,
  examLabel: string,
  reviewUrl: string,
): Promise<{ sent: number; failed: number }> {
  const text = `🔎 ${professorName} terminou a revisão de: *${examLabel}* — pronta pra aprovação.\n${reviewUrl}`
  const results = await Promise.all(recipientEmails.map((email) => sendChatDirectMessage(email, text)))
  return { sent: results.filter(Boolean).length, failed: results.filter((r) => !r).length }
}

/**
 * Gatilho 4 (Worker → solicitante, Subtarefa 1a da fila, 24/07/2026): um
 * job da fila de geração terminou. Sucesso avisa que a prova está pronta
 * pra revisão; erro só é notificado quando é definitivo (sem retries
 * restantes) — retry automático não gera ruído no Chat.
 */
export async function sendChatGenerationJobNotification(
  userEmail: string,
  jobLabel: string,
  outcome: 'concluido' | 'erro',
  examUrl?: string,
): Promise<boolean> {
  // Texto neutro de propósito: o mesmo gatilho serve pra prova comum e pra
  // atividade de reforço ENEM — o jobLabel diz o que é.
  const text = outcome === 'concluido'
    ? `🧾 Pronto pra revisão: *${jobLabel}*${examUrl ? `\n${examUrl}` : ''}`
    : `⚠️ A geração de *${jobLabel}* falhou após todas as tentativas. Veja o erro na aba Histórico e Fila de Provas.`
  return sendChatDirectMessage(userEmail, text)
}

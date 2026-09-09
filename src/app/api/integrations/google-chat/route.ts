import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { googleChatInstallations } from '@/db/schema'
import { hashGoogleChatConnectToken, isGoogleWorkspaceAddOnEvent, normalizeGoogleChatEvent, privateGoogleChatInstallation } from '@/lib/notifications/googleChatInstallation'

export const dynamic = 'force-dynamic'

const CHAT_SENDER = 'chat@system.gserviceaccount.com'
const TOKEN_TTL_MS = 30 * 60 * 1000

type ChatReplyMessage = { text?: string; cardsV2?: unknown[] }

function getPublicBaseUrl(): URL | null {
  const configured = process.env.GOOGLE_CHAT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL
  if (!configured) return null
  try {
    const url = new URL(configured)
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function isVerifiedChatRequest(request: NextRequest): Promise<boolean> {
  const audience = process.env.GOOGLE_CHAT_ENDPOINT_AUDIENCE
  const workspaceAddOnSender = process.env.GOOGLE_WORKSPACE_ADD_ON_SERVICE_ACCOUNT_EMAIL
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  if (!audience || !token) return false
  try {
    const ticket = await new google.auth.OAuth2().verifyIdToken({ idToken: token, audience })
    const payload = ticket.getPayload()
    const trustedSenders = [CHAT_SENDER, workspaceAddOnSender].filter((email): email is string => Boolean(email))
    return payload?.email_verified === true && trustedSenders.includes(payload.email ?? '')
  } catch {
    return false
  }
}

function connectionCard(connectUrl: string): ChatReplyMessage {
  return { cardsV2: [{ cardId: 'connect-prova-tri', card: {
    header: { title: 'Notificações privadas do Prova-tri' },
    sections: [{ widgets: [
      { textParagraph: { text: 'Conecte sua conta do Prova-tri para receber somente as notificações destinadas a você.' } },
      { buttonList: { buttons: [{ text: 'Conectar minha conta', onClick: { openLink: { url: connectUrl } } }] } },
    ] }],
  } }] }
}

// Complementos do Workspace precisam devolver a ação de criação de mensagem;
// o mesmo endpoint também continua atendendo o formato do app Chat independente.
function replyForChatEvent(event: unknown, message: ChatReplyMessage) {
  if (!isGoogleWorkspaceAddOnEvent(event)) return message
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message } } } }
}

// O evento do Chat fornece o ID da conversa. O link de uso único exige a
// sessão normal do Prova-tri, eliminando qualquer associação por e-mail.
export async function POST(request: NextRequest) {
  if (!await isVerifiedChatRequest(request)) return NextResponse.json({ error: 'Origem do Google Chat não verificada.' }, { status: 401 })
  const rawEvent = await request.json().catch(() => null) as unknown
  const event = normalizeGoogleChatEvent(rawEvent)
  if (!event) return NextResponse.json({ error: 'Evento inválido.' }, { status: 400 })

  if (event.type === 'REMOVED_FROM_SPACE' && event.space?.name) {
    await db.update(googleChatInstallations).set({ active: false, removedAt: new Date(), updatedAt: new Date() }).where(eq(googleChatInstallations.spaceName, event.space.name))
    return NextResponse.json({})
  }

  const installation = privateGoogleChatInstallation(event)
  if (!installation) return NextResponse.json(replyForChatEvent(rawEvent, { text: 'Use este app em uma conversa direta para ativar notificações privadas.' }))

  const existingInstallation = await db.query.googleChatInstallations.findFirst({
    where: eq(googleChatInstallations.chatUserId, installation.chatUserId),
    columns: { userId: true, active: true },
  })
  if (existingInstallation?.userId && existingInstallation.active) {
    return NextResponse.json(replyForChatEvent(rawEvent, { text: 'Suas notificações privadas do Prova-tri já estão ativas.' }))
  }

  const publicBaseUrl = getPublicBaseUrl()
  if (!publicBaseUrl) {
    console.error('[googleChat] GOOGLE_CHAT_PUBLIC_BASE_URL precisa ser uma URL HTTPS pública.')
    return NextResponse.json(replyForChatEvent(rawEvent, { text: 'A integração ainda está sendo configurada. Tente novamente em alguns minutos.' }))
  }

  const token = randomUUID()
  const now = new Date()
  await db.insert(googleChatInstallations).values({
    ...installation,
    connectTokenHash: hashGoogleChatConnectToken(token),
    connectTokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    active: true,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: googleChatInstallations.chatUserId,
    set: {
      userId: null,
      spaceName: installation.spaceName,
      connectTokenHash: hashGoogleChatConnectToken(token),
      connectTokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      active: true,
      connectedAt: null,
      removedAt: null,
      updatedAt: now,
    },
  })

  const connectUrl = new URL('/api/integrations/google-chat/confirm', publicBaseUrl)
  connectUrl.searchParams.set('token', token)
  return NextResponse.json(replyForChatEvent(rawEvent, connectionCard(connectUrl.toString())))
}

import { createHash } from 'node:crypto'

export type GoogleChatEvent = {
  type?: string
  user?: { name?: string }
  space?: { name?: string; spaceType?: string; type?: string }
}

type WorkspaceAddOnEvent = {
  chat?: {
    user?: GoogleChatEvent['user']
    space?: GoogleChatEvent['space']
    addedToSpacePayload?: { space?: GoogleChatEvent['space'] }
    messagePayload?: { space?: GoogleChatEvent['space'] }
    removedFromSpacePayload?: { space?: GoogleChatEvent['space'] }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Apps configurados como complementos do Workspace recebem os eventos em
// `chat.*Payload`; apps independentes recebem `type`, `user` e `space` na raiz.
export function isGoogleWorkspaceAddOnEvent(event: unknown): event is WorkspaceAddOnEvent {
  return isRecord(event) && isRecord(event.chat)
}

export function normalizeGoogleChatEvent(event: unknown): GoogleChatEvent | null {
  if (!isRecord(event)) return null

  if (isGoogleWorkspaceAddOnEvent(event)) {
    const chat = event.chat
    if (!chat) return null
    if (chat.addedToSpacePayload) return { type: 'ADDED_TO_SPACE', user: chat.user, space: chat.addedToSpacePayload.space ?? chat.space }
    if (chat.messagePayload) return { type: 'MESSAGE', user: chat.user, space: chat.messagePayload.space ?? chat.space }
    if (chat.removedFromSpacePayload) return { type: 'REMOVED_FROM_SPACE', user: chat.user, space: chat.removedFromSpacePayload.space ?? chat.space }
    return null
  }

  return event as GoogleChatEvent
}

export function hashGoogleChatConnectToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// A conversa só pode ser registrada quando o próprio Chat declara uma DM.
// `MESSAGE` permite retomar o onboarding quando o app já estava instalado antes
// de o endpoint ser configurado. Eventos de espaço/grupo são ignorados.
export function privateGoogleChatInstallation(event: GoogleChatEvent) {
  const spaceType = event.space?.spaceType ?? event.space?.type
  if (!['ADDED_TO_SPACE', 'MESSAGE'].includes(event.type ?? '') || spaceType !== 'DIRECT_MESSAGE') return null
  if (!event.user?.name?.startsWith('users/') || !event.space?.name?.startsWith('spaces/')) return null
  return { chatUserId: event.user.name, spaceName: event.space.name }
}

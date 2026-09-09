import { and, eq, gt, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { googleChatInstallations, users } from '@/db/schema'
import { hashGoogleChatConnectToken } from '@/lib/notifications/googleChatInstallation'

function getPublicBaseUrl(request: NextRequest): URL {
  const configured = process.env.GOOGLE_CHAT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'https:') return url
    } catch {
      // The request URL is only a fallback for an invalid configuration.
    }
  }
  return request.nextUrl
}

function redirectToChatStatus(request: NextRequest, status: 'invalid' | 'forbidden' | 'expired' | 'connected') {
  const url = new URL('/', getPublicBaseUrl(request))
  url.searchParams.set('chat', status)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return redirectToChatStatus(request, 'invalid')
  const session = await auth()
  if (!session?.user?.email) {
    const loginUrl = new URL('/login', getPublicBaseUrl(request))
    loginUrl.searchParams.set('callbackUrl', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, active: true } })
  if (!user?.active) return redirectToChatStatus(request, 'forbidden')
  const installation = await db.query.googleChatInstallations.findFirst({
    where: and(eq(googleChatInstallations.connectTokenHash, hashGoogleChatConnectToken(token)), gt(googleChatInstallations.connectTokenExpiresAt, new Date()), eq(googleChatInstallations.active, true), isNull(googleChatInstallations.userId)),
    columns: { id: true },
  })
  if (!installation) return redirectToChatStatus(request, 'expired')

  await db.update(googleChatInstallations).set({ userId: null, active: false, updatedAt: new Date() }).where(eq(googleChatInstallations.userId, user.id))
  await db.update(googleChatInstallations).set({ userId: user.id, connectedAt: new Date(), updatedAt: new Date() }).where(eq(googleChatInstallations.id, installation.id))
  return redirectToChatStatus(request, 'connected')
}

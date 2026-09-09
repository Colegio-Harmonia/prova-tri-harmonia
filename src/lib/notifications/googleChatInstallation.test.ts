import { describe, expect, it } from 'vitest'

import {
  hashGoogleChatConnectToken,
  isGoogleWorkspaceAddOnEvent,
  normalizeGoogleChatEvent,
  privateGoogleChatInstallation,
} from './googleChatInstallation'

const directMessageSpace = {
  name: 'spaces/AAAA',
  spaceType: 'DIRECT_MESSAGE',
}

describe('Google Chat private notification installation', () => {
  it('hashes connection tokens deterministically without retaining the token', () => {
    expect(hashGoogleChatConnectToken('one-time-token')).toBe(hashGoogleChatConnectToken('one-time-token'))
    expect(hashGoogleChatConnectToken('one-time-token')).not.toBe(hashGoogleChatConnectToken('another-token'))
  })

  it('normalizes both direct Google Chat events and Workspace Add-on payloads', () => {
    const standardEvent = {
      type: 'ADDED_TO_SPACE',
      user: { name: 'users/123' },
      space: directMessageSpace,
    }
    const workspaceMessage = {
      chat: {
        user: { name: 'users/123' },
        space: directMessageSpace,
        messagePayload: { space: directMessageSpace },
      },
    }

    expect(normalizeGoogleChatEvent(standardEvent)).toEqual(standardEvent)
    expect(isGoogleWorkspaceAddOnEvent(workspaceMessage)).toBe(true)
    expect(normalizeGoogleChatEvent(workspaceMessage)).toEqual({
      type: 'MESSAGE',
      user: { name: 'users/123' },
      space: directMessageSpace,
    })
    expect(
      normalizeGoogleChatEvent({
        chat: {
          user: { name: 'users/123' },
          removedFromSpacePayload: { space: directMessageSpace },
        },
      }),
    ).toEqual({
      type: 'REMOVED_FROM_SPACE',
      user: { name: 'users/123' },
      space: directMessageSpace,
    })
  })

  it('rejects incomplete and unsupported Workspace Add-on payloads', () => {
    expect(isGoogleWorkspaceAddOnEvent(null)).toBe(false)
    expect(isGoogleWorkspaceAddOnEvent({ chat: null })).toBe(false)
    expect(normalizeGoogleChatEvent(null)).toBeNull()
    expect(normalizeGoogleChatEvent({ chat: { user: { name: 'users/123' } } })).toBeNull()
  })

  it('registers only a valid direct-message space for the requesting user', () => {
    expect(
      privateGoogleChatInstallation({
        type: 'ADDED_TO_SPACE',
        user: { name: 'users/123' },
        space: directMessageSpace,
      }),
    ).toEqual({
      chatUserId: 'users/123',
      spaceName: 'spaces/AAAA',
    })
    expect(
      privateGoogleChatInstallation({
        type: 'MESSAGE',
        user: { name: 'users/123' },
        space: { name: 'spaces/BBBB', type: 'DIRECT_MESSAGE' },
      }),
    ).toEqual({
      chatUserId: 'users/123',
      spaceName: 'spaces/BBBB',
    })
    expect(
      privateGoogleChatInstallation({
        type: 'ADDED_TO_SPACE',
        user: { name: 'users/123' },
        space: { name: 'spaces/group', spaceType: 'SPACE' },
      }),
    ).toBeNull()
    expect(privateGoogleChatInstallation({ type: 'MESSAGE' })).toBeNull()
    expect(
      privateGoogleChatInstallation({
        type: 'MESSAGE',
        user: { name: 'not-a-chat-user' },
        space: directMessageSpace,
      }),
    ).toBeNull()
  })
})

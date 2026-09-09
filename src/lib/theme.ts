export const THEME_PREFERENCE_KEY = 'prova-tri-theme'

export const themePreferences = ['system', 'light', 'dark'] as const

export type ThemePreference = (typeof themePreferences)[number]

export function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && themePreferences.includes(value as ThemePreference)
}

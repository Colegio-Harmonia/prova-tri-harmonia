import { google, sheets_v4 } from 'googleapis'

let cachedClient: sheets_v4.Sheets | null = null

export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  if (!keyFile) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH não configurado')

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })

  cachedClient = google.sheets({ version: 'v4', auth })
  return cachedClient
}

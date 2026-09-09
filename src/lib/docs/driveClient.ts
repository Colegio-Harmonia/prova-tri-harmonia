import { google, drive_v3, docs_v1 } from 'googleapis'
import https from 'node:https'

let cachedDrive: drive_v3.Drive | null = null
let cachedDocs: docs_v1.Docs | null = null

// O host do servidor não tem rota IPv6 funcional até o Google. A conta de
// serviço troca seu JWT por access token em oauth2.googleapis.com antes de
// qualquer chamada ao Drive/Docs; sem este agente, essa troca pode expirar
// mesmo que a chave e as permissões estejam corretas.
const googleServiceAccountIpv4Agent = new https.Agent({ family: 4, keepAlive: true })

function getAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  if (!keyFile) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH não configurado')
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'],
    // `clientOptions` chega ao cliente JWT criado pelo GoogleAuth. O agent
    // cobre a troca do token da conta de serviço, sem alterar fetches ou
    // conexões de outros provedores.
    clientOptions: {
      transporterOptions: { agent: googleServiceAccountIpv4Agent },
    },
  })
}

export function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive
  cachedDrive = google.drive({ version: 'v3', auth: getAuth() })
  return cachedDrive
}

export function getDocsClient(): docs_v1.Docs {
  if (cachedDocs) return cachedDocs
  cachedDocs = google.docs({ version: 'v1', auth: getAuth() })
  return cachedDocs
}

/**
 * Ported from harmohub/server/drive-service.js's _findOrCreateFolder —
 * same query-then-create pattern, same supportsAllDrives/
 * includeItemsFromAllDrives flags (the school's Drive is a Shared Drive).
 */
export async function findOrCreateFolder(drive: drive_v3.Drive, name: string, parentId: string): Promise<string> {
  const escaped = name.replace(/'/g, "\\'")
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false and '${parentId}' in parents`

  const { data } = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  if (data.files?.length) return data.files[0].id as string

  const { data: folder } = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  })
  return folder.id as string
}

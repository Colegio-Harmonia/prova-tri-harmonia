/**
 * Criptografia de campo para dados pessoais de aluno (LGPD).
 *
 * O que protege: quem obtiver o banco ou um backup vê notas e respostas, mas
 * não nomes, e-mails nem identificadores do Classroom. O que NÃO protege: um
 * usuário com login válido — a aplicação decifra para mostrar ao professor, e
 * isso continua a cargo das permissões por perfil.
 *
 * - Cifra: AES-256-GCM, IV aleatório por valor. Formato gravado:
 *   `enc:v1:<base64url(iv | tag | cifra)>`.
 * - Como o IV é aleatório, o mesmo nome gera cifras diferentes: o banco não
 *   consegue comparar nem ordenar. Para "é o mesmo aluno?" existe o ÍNDICE
 *   CEGO (`blindIndex`), um HMAC do valor normalizado, gravado em coluna
 *   própria. Ordenação por nome é feita na aplicação, depois de decifrar.
 * - Chave: `STUDENT_DATA_KEY` (32 bytes em base64), fora do banco. Dela saem,
 *   por HKDF, uma chave de cifra e uma de índice. PERDER A CHAVE É PERDER OS
 *   NOMES: guardar cópia em local seguro, separado dos backups do banco.
 * - Sem chave configurada (desenvolvimento, CI, ou produção antes da ativação)
 *   os valores passam em texto puro e o índice é um SHA-256 simples — o mesmo
 *   que a migration calcula em SQL —, de modo que o sistema funciona igual
 *   antes e depois de ativar. `decryptField` sempre aceita texto puro legado.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const IV_BYTES = 12
const TAG_BYTES = 16

type Keys = { enc: Buffer; index: Buffer }
let cached: { source: string; keys: Keys } | null = null

export class FieldCryptoError extends Error {
  constructor(message: string) { super(message); this.name = 'FieldCryptoError' }
}

function loadKeys(): Keys | null {
  const source = process.env.STUDENT_DATA_KEY?.trim() ?? ''
  if (!source) return null
  if (cached?.source === source) return cached.keys
  const master = Buffer.from(source, 'base64')
  if (master.length !== 32) throw new FieldCryptoError('STUDENT_DATA_KEY deve ter 32 bytes em base64 (gere com: openssl rand -base64 32).')
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `prova-tri/student-data/${info}`, 32))
  cached = { source, keys: { enc: derive('enc-v1'), index: derive('index-v1') } }
  return cached.keys
}

/** true quando a chave está configurada e os dados novos são gravados cifrados. */
export function fieldEncryptionEnabled(): boolean {
  return loadKeys() !== null
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/** Cifra um valor para gravar. Sem chave, devolve o texto como veio. Não cifra duas vezes. */
export function encryptField(plain: string): string {
  const keys = loadKeys()
  if (!keys || isEncryptedValue(plain)) return plain
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.enc, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}

/** Decifra um valor lido. Texto puro legado passa direto; cifra adulterada ou chave errada lança erro. */
export function decryptField(stored: string): string {
  if (!isEncryptedValue(stored)) return stored
  const keys = loadKeys()
  if (!keys) throw new FieldCryptoError('Há dados de aluno cifrados no banco, mas STUDENT_DATA_KEY não está configurada.')
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url')
  if (raw.length < IV_BYTES + TAG_BYTES) throw new FieldCryptoError('Valor cifrado corrompido.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.enc, raw.subarray(0, IV_BYTES))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  } catch {
    throw new FieldCryptoError('Não foi possível decifrar um dado de aluno: a chave configurada não é a que gravou o valor, ou ele foi adulterado.')
  }
}

/** SHA-256 simples do valor exato — o mesmo que `encode(sha256(convert_to(col, 'UTF8')), 'hex')` no Postgres. */
export function plainIndex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Índice cego para igualdade e unicidade. Com chave: HMAC-SHA256 do valor
 * exato (quem tem só o banco não consegue testar nomes). Sem chave: o SHA-256
 * simples. O valor NÃO é normalizado: "é o mesmo" continua significando o
 * mesmo que a comparação de texto que existia antes.
 */
export function blindIndex(value: string): string {
  const keys = loadKeys()
  return keys ? createHmac('sha256', keys.index).update(value, 'utf8').digest('hex') : plainIndex(value)
}

/** Só para testes: esquece a chave derivada em memória. */
export function resetFieldCryptoCache(): void {
  cached = null
}

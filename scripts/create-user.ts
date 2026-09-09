/**
 * Bootstrap/manage prova-tri user accounts.
 * Usage: tsx scripts/create-user.ts --email a@b.com --name "Nome" --password "senha" --role coordenacao
 */
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { users } from '../src/db/schema'

function parseArgs() {
  const args: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const value = argv[i + 1]
    if (key && value) args[key] = value
  }
  return args
}

async function main() {
  const { email, name, password, role } = parseArgs()

  if (!email || !name || !password) {
    console.error('Uso: tsx scripts/create-user.ts --email <email> --name "<nome>" --password "<senha>" --role <coordenacao|professor|direcao>')
    process.exit(1)
  }

  const resolvedRole = role === 'coordenacao' || role === 'direcao' ? role : 'professor'
  const passwordHash = await bcrypt.hash(password, 10)

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) {
    await db.update(users).set({ name, passwordHash, role: resolvedRole, active: true }).where(eq(users.email, email))
    console.log(`Usuário ${email} atualizado (role: ${resolvedRole}).`)
  } else {
    await db.insert(users).values({ email, name, passwordHash, role: resolvedRole })
    console.log(`Usuário ${email} criado (role: ${resolvedRole}).`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

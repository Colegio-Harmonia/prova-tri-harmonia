export async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text()

  if (!raw.trim()) {
    throw new Error(response.ok
      ? 'O servidor retornou uma resposta vazia.'
      : `O servidor não respondeu corretamente (HTTP ${response.status}).`)
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`O servidor retornou uma resposta inválida (HTTP ${response.status}).`)
  }
}

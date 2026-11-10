/** Falhas que exigem configuração/pagamento, sem repetir a geração inteira. */
export function isPermanentAiProviderFailure(code: string): boolean {
  return ['provider_payment_required', 'provider_auth', 'provider_not_configured', 'provider_not_implemented'].includes(code)
    || /^provider_http_4\d\d/.test(code)
}

export function providerFailureMessage(code: string): string {
  if (code === 'provider_payment_required' || /^provider_http_402(?:_|$)/.test(code)) {
    return 'O provedor de IA está sem saldo ou exige regularização do pagamento. A gestão precisa recarregar a conta ou configurar outro modelo em IA.'
  }
  return 'O provedor recusou a requisição. Confira a configuração do modelo em IA antes de tentar novamente.'
}

export function canUseTextFallback(code: string): boolean {
  return ['provider_payment_required', 'provider_http_402', 'provider_auth', 'provider_not_configured', 'timeout', 'rate_limited', 'provider_unavailable', 'provider_request_failed'].includes(code)
}

// Frente 14 (segunda camada, carga real), Lote 14: intervalo fixo de 5s
// polling o status do Pix pendente, sem crescer com o tempo — num pico de
// vendas Pix simultâneas (campanha de marketing), N usuários pagando ao
// mesmo tempo mantinham N/5 req/s sustentados nesse endpoint indefinidamente,
// mesmo quando o pagamento não confirma rápido. Pix costuma confirmar em
// segundos quando confirma, então mantém granularidade fina no início e
// espaça as tentativas depois.
export function nextPixPollDelayMs(pollCount: number): number {
  if (pollCount < 6) return 5_000; // 0-30s: a cada 5s
  if (pollCount < 12) return 10_000; // 30-90s: a cada 10s
  return 20_000; // depois de 90s: a cada 20s
}

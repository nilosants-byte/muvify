import * as Sentry from "@sentry/node";
import {
  MemoryStore,
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options,
  type Store
} from "express-rate-limit";

const REPORT_INTERVAL_MS = 60_000;

// Contagem do limite de tentativas que sobrevive à queda do Redis.
//
// Antes, cada limiter usava o RedisStore direto com passOnStoreError: true.
// Com o Redis fora do ar, toda contagem dava erro e o express-rate-limit
// deixava a requisição passar: o limite simplesmente sumia (inclusive o de
// login, 20 por 15 min), justamente num momento de instabilidade.
//
// Aqui o Redis continua sendo o balde principal (compartilhado entre
// instâncias da API). Quando ele não está pronto, ou um comando falha, a
// contagem cai pra memória do próprio processo até o Redis voltar. Com uma
// instância só, o limite fica igual; com várias, cada uma conta a sua parte
// durante a queda. Em nenhum caso o limite deixa de existir.
export class ResilientRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix?: string;
  private readonly fallback = new MemoryStore();
  private lastReportAt = 0;

  constructor(
    private readonly primary: Store,
    private readonly isPrimaryReady: () => boolean
  ) {
    this.prefix = primary.prefix;
  }

  init(options: Options) {
    this.primary.init?.(options);
    this.fallback.init(options);
  }

  get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.run((store) => store.get?.(key));
  }

  increment(key: string): Promise<IncrementResponse> {
    return this.run((store) => store.increment(key));
  }

  async decrement(key: string): Promise<void> {
    await this.run((store) => store.decrement(key));
  }

  async resetKey(key: string): Promise<void> {
    await this.run((store) => store.resetKey(key));
  }

  shutdown() {
    this.fallback.shutdown();
  }

  private async run<T>(operation: (store: Store) => T | Promise<T>): Promise<T> {
    // Redis fora do ar: nem tenta (o ioredis faria a requisição esperar as
    // novas tentativas de conexão antes de falhar). A queda em si já é
    // reportada pelo listener de "error" em config/redis.ts.
    if (this.isPrimaryReady()) {
      try {
        return await operation(this.primary);
      } catch (error) {
        this.report(error);
      }
    }
    return operation(this.fallback);
  }

  // Um comando que falha com o Redis "pronto" é raro, mas sob carga pode se
  // repetir a cada requisição: reporta no máximo uma vez por minuto.
  private report(error: unknown) {
    const now = Date.now();
    if (now - this.lastReportAt < REPORT_INTERVAL_MS) return;
    this.lastReportAt = now;
    console.error(`[rate-limit] Falha no Redis (${this.prefix ?? ""}), contando em memória:`, error);
    Sentry.captureException(error, { tags: { area: "rate-limit-store" } });
  }
}

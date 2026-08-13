import { nextPixPollDelayMs } from "../utils/pixPolling";

// Frente 14 (segunda camada, carga real), Lote 14: BookingConfirmationScreen
// e MyTrainingScreen faziam polling do status do Pix pendente num intervalo
// FIXO de 5s, sem nenhum degrau de backoff — num pico de vendas Pix
// simultâneas, N usuários pagando ao mesmo tempo mantinham N/5 req/s
// sustentados indefinidamente nesse endpoint. nextPixPollDelayMs cresce o
// intervalo com o tempo, mantendo granularidade fina no início (Pix costuma
// confirmar rápido quando confirma).

describe("Frente 14, Lote 14 — nextPixPollDelayMs cresce o intervalo de polling do Pix com o tempo", () => {
  it("primeiras tentativas (0-5) mantêm o intervalo fino de 5s", () => {
    for (let i = 0; i < 6; i++) {
      expect(nextPixPollDelayMs(i)).toBe(5_000);
    }
  });

  it("tentativas intermediárias (6-11) espaçam para 10s", () => {
    for (let i = 6; i < 12; i++) {
      expect(nextPixPollDelayMs(i)).toBe(10_000);
    }
  });

  it("depois de 12 tentativas, espaça para 20s e não volta a diminuir", () => {
    expect(nextPixPollDelayMs(12)).toBe(20_000);
    expect(nextPixPollDelayMs(50)).toBe(20_000);
    expect(nextPixPollDelayMs(1000)).toBe(20_000);
  });

  it("o intervalo nunca decresce à medida que pollCount aumenta", () => {
    let previous = 0;
    for (let i = 0; i < 30; i++) {
      const current = nextPixPollDelayMs(i);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

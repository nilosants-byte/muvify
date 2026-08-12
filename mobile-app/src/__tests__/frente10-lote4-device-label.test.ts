import { friendlyDeviceLabel } from "../utils/formatters";

// Frente 10 (segunda camada), Lote 4: sessões sem X-Device-Label (login
// web, sessões antigas) guardavam o User-Agent técnico cru na tela
// "Aparelhos conectados" - ilegível pro usuário final.

describe("Frente 10, Lote 4 — friendlyDeviceLabel", () => {
  it("nulo/vazio vira 'Aparelho desconhecido'", () => {
    expect(friendlyDeviceLabel(null)).toBe("Aparelho desconhecido");
    expect(friendlyDeviceLabel(undefined)).toBe("Aparelho desconhecido");
  });

  it("nome de aparelho já legível (enviado via X-Device-Label) passa intacto", () => {
    expect(friendlyDeviceLabel("iPhone 15 Pro")).toBe("iPhone 15 Pro");
    expect(friendlyDeviceLabel("Pixel 8")).toBe("Pixel 8");
  });

  it("User-Agent técnico de navegador Android/Chrome vira 'Android · Chrome'", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
    expect(friendlyDeviceLabel(ua)).toBe("Android · Chrome");
  });

  it("User-Agent técnico de iPhone/Safari vira 'iOS · Safari'", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1";
    expect(friendlyDeviceLabel(ua)).toBe("iOS · Safari");
  });

  it("User-Agent técnico de desktop Windows/Edge vira 'Windows · Edge'", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0";
    expect(friendlyDeviceLabel(ua)).toBe("Windows · Edge");
  });

  it("User-Agent técnico de cliente HTTP nativo (okhttp) vira 'Android · App'", () => {
    expect(friendlyDeviceLabel("okhttp/4.12.0 (Linux; Android 13)")).toBe("Android · App");
  });
});

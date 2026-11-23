import { describe, it, expect } from "vitest";
import { jitterPublicCoordinates } from "../src/modules/providers/services/provider.service";

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

// Com a direção sorteada em cima de um eixo (0°/90°/180°/270°), um dos deslocamentos
// dava ~0 e a latitude ou a longitude real saía exata (~1 a cada 90 profissionais).
describe("deslocamento público da localização do profissional", () => {
  const latitude = -23.55052;
  const longitude = -46.633308;
  const ids = Array.from({ length: 5000 }, (_, i) => `provider-${i}`);

  it("nunca devolve nenhuma das duas coordenadas reais", () => {
    const exposed = ids.filter((id) => {
      const out = jitterPublicCoordinates({ id, latitude, longitude });
      return out.latitude === latitude || out.longitude === longitude;
    });
    expect(exposed).toEqual([]);
  });

  it("desloca cada coordenada de forma perceptível e mantém o ponto a 300-500m", () => {
    for (const id of ids) {
      const out = jitterPublicCoordinates({ id, latitude, longitude });
      expect(haversineMeters(latitude, longitude, out.latitude, longitude)).toBeGreaterThan(90);
      expect(haversineMeters(latitude, longitude, latitude, out.longitude)).toBeGreaterThan(90);
      const total = haversineMeters(latitude, longitude, out.latitude, out.longitude);
      expect(total).toBeGreaterThanOrEqual(299);
      expect(total).toBeLessThanOrEqual(501);
    }
  });

  it("é estável por profissional (o pino não pula entre uma busca e outra)", () => {
    const first = jitterPublicCoordinates({ id: "provider-estavel", latitude, longitude });
    const second = jitterPublicCoordinates({ id: "provider-estavel", latitude, longitude });
    expect(second).toEqual(first);
  });
});

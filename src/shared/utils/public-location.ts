import { haversineKm } from "./geo";

// Localização base do profissional (usada pro raio de atendimento a
// domicílio): pra quem atende de casa sem endereço comercial cadastrado
// (fixedLocations, que são intencionalmente públicos), ela é o endereço
// residencial. Por isso, pra quem está de fora, ela só existe deslocada:
// um ponto fixo e determinístico a 300-500 m do real, estável por
// profissional (o pino do mapa).
//
// Regra: TUDO que responde a alguém de fora usa esse ponto público, nunca o
// real. Não basta esconder a coordenada: uma distância calculada a partir do
// ponto real ("a 2,3 km"), um filtro de raio ou um "fora da área de
// atendimento" também revelam o endereço, cruzando pedidos feitos de pontos
// diferentes (trilateração). Calculados a partir do ponto público, esses
// mesmos pedidos só revelam o próprio pino, que já é público.

function hashSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function jitterPublicCoordinates<T extends { id: string; latitude?: number | null; longitude?: number | null }>(
  provider: T
): T {
  if (typeof provider.latitude !== "number" || typeof provider.longitude !== "number") {
    return provider;
  }
  const seed = hashSeed(provider.id);
  // Direção sempre entre 20° e 70° dentro de um dos 4 quadrantes: em cima de um eixo
  // (0°/90°/180°/270°) um dos deslocamentos dava ~0 e uma coordenada real saía exata.
  const angleDeg = 20 + (seed % 51) + 90 * (Math.floor(seed / 51) % 4);
  const angleRad = angleDeg * (Math.PI / 180);
  const distanceMeters = 300 + (seed % 201);
  const latRad = (provider.latitude * Math.PI) / 180;
  const deltaLat = (distanceMeters * Math.cos(angleRad)) / 111_320;
  const deltaLng = (distanceMeters * Math.sin(angleRad)) / (111_320 * Math.cos(latRad));
  return {
    ...provider,
    latitude: provider.latitude + deltaLat,
    longitude: provider.longitude + deltaLng
  };
}

// Distância (km) entre um ponto qualquer e a localização base PÚBLICA do
// profissional. undefined quando ele não tem localização base.
export function distanceFromPublicBaseKm(
  provider: { id: string; latitude?: number | null; longitude?: number | null },
  latitude: number,
  longitude: number
): number | undefined {
  const base = jitterPublicCoordinates({ id: provider.id, latitude: provider.latitude, longitude: provider.longitude });
  if (typeof base.latitude !== "number" || typeof base.longitude !== "number") return undefined;
  return haversineKm(base.latitude, base.longitude, latitude, longitude);
}

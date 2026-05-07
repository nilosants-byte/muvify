import { useEffect, useRef, useState } from "react";

export type FitnessVenue = {
  name: string;
  /** Formatted address for display / filling Campo 3 */
  address: string;
  lat: number;
  lon: number;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OverpassElement[];
};

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// OSM tags that represent fitness/outdoor activity venues
const OVERPASS_QUERY = (lat: number, lon: number, radiusM: number) => `
[out:json][timeout:30];
(
  node["amenity"~"^(gym|fitness_centre|sports_centre|swimming_pool|dojo)$"](around:${radiusM},${lat},${lon});
  way["amenity"~"^(gym|fitness_centre|sports_centre|swimming_pool|dojo)$"](around:${radiusM},${lat},${lon});
  node["leisure"~"^(fitness_centre|sports_centre|pitch|stadium|swimming_pool|sports_hall|track|park|garden|recreation_ground)$"](around:${radiusM},${lat},${lon});
  way["leisure"~"^(fitness_centre|sports_centre|pitch|stadium|swimming_pool|sports_hall|track|park|garden|recreation_ground)$"](around:${radiusM},${lat},${lon});
  node["natural"~"^(beach|coastline)$"](around:${radiusM},${lat},${lon});
  way["natural"~"^(beach|coastline)$"](around:${radiusM},${lat},${lon});
  node["place"="square"](around:${radiusM},${lat},${lon});
  way["place"="square"](around:${radiusM},${lat},${lon});
);
out center tags;
`.trim();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildAddress(tags: Record<string, string>): string {
  const parts: string[] = [];
  const name = tags["name"];
  const street = tags["addr:street"];
  const number = tags["addr:housenumber"];
  const suburb = tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:district"];
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];

  if (name) parts.push(name);
  if (street) parts.push(number ? `${street}, ${number}` : street);
  if (suburb) parts.push(suburb);
  if (city) parts.push(city);

  return parts.join(", ");
}

/**
 * Fetches ALL fitness/outdoor venues within a radius using the Overpass API.
 * Results are cached as long as the center hasn't moved more than 500m and the radius is the same.
 * This powers the Campo 2 and Campo 3 suggestion lists with full area coverage.
 */
export function useAreaFitnessVenues(
  lat: number,
  lon: number,
  radiusKm: number,
  enabled: boolean
) {
  const [venues, setVenues] = useState<FitnessVenue[]>([]);
  const [loading, setLoading] = useState(false);

  // Cache: avoid re-fetching if center moved < 500m and radius unchanged
  const cacheRef = useRef<{
    lat: number;
    lon: number;
    radiusKm: number;
    venues: FitnessVenue[];
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const cache = cacheRef.current;
    if (
      cache &&
      cache.radiusKm === radiusKm &&
      haversineKm(cache.lat, cache.lon, lat, lon) < 0.5
    ) {
      setVenues(cache.venues);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    // Small debounce so rapid location changes don't flood Overpass
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const radiusM = Math.round(Math.min(radiusKm, 50) * 1000);
        const body = OVERPASS_QUERY(lat, lon, radiusM);

        const resp = await fetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(body)}`,
          signal: controller.signal,
        });

        const json = (await resp.json()) as OverpassResponse;

        const seen = new Set<string>();
        const result: FitnessVenue[] = [];

        for (const el of json.elements) {
          const tags = el.tags ?? {};
          const name = tags["name"]?.trim();
          if (!name) continue; // skip unnamed venues

          const elLat = el.lat ?? el.center?.lat;
          const elLon = el.lon ?? el.center?.lon;
          if (!Number.isFinite(elLat) || !Number.isFinite(elLon)) continue;

          const key = name.toLocaleLowerCase("pt-BR");
          if (seen.has(key)) continue;
          seen.add(key);

          const address = buildAddress(tags) || name;

          result.push({ name, address, lat: elLat as number, lon: elLon as number });
        }

        // Sort by distance from center
        result.sort(
          (a, b) => haversineKm(lat, lon, a.lat, a.lon) - haversineKm(lat, lon, b.lat, b.lon)
        );

        cacheRef.current = { lat, lon, radiusKm, venues: result };
        setVenues(result);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setVenues([]);
        }
      } finally {
        setLoading(false);
      }
    }, 600);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lat, lon, radiusKm, enabled]);

  return { venues, loading };
}

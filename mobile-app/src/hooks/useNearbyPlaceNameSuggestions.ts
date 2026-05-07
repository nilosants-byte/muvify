import { useEffect, useMemo, useRef, useState } from "react";
import { FitnessVenue } from "./useAreaFitnessVenues";

export type NearbyPlaceNameSuggestion = {
  name: string;
  /** Formatted address — use to fill Campo 3 */
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

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

function normalize(s: string) {
  return s
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Campo 2 — venue name search.
 *
 * Step 1 (instant): client-side filter on the pre-loaded Overpass area scan.
 * Step 2 (fallback): if fewer than 2 matches, fires a direct Overpass query searching
 *   any OSM entity whose *name* contains the typed text — regardless of amenity/leisure tag.
 *   This catches gyms tagged in unexpected ways (e.g. sport=fitness, amenity=studio, etc.).
 */
export function useNearbyPlaceNameSuggestions(
  query: string,
  venues: FitnessVenue[],
  enabled: boolean,
  centerLat: number,
  centerLon: number,
  radiusKm: number
): { suggestions: NearbyPlaceNameSuggestion[]; loading: boolean } {
  // ── Step 1: instant client-side filter ──────────────────────────────────────
  const localMatches = useMemo<NearbyPlaceNameSuggestion[]>(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 2) return [];
    const needle = normalize(trimmed);
    return venues
      .filter((v) => normalize(v.name).includes(needle) || normalize(v.address).includes(needle))
      .slice(0, 6)
      .map(({ name, address, lat, lon }) => ({ name, address, lat, lon }));
  }, [query, venues, enabled]);

  // ── Step 2: direct Overpass name search when local results are sparse ────────
  const [remoteMatches, setRemoteMatches] = useState<NearbyPlaceNameSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    // Only fire Overpass name search when local results are insufficient
    const needsRemote = enabled && trimmed.length >= 2 && localMatches.length < 2;

    if (!needsRemote) {
      setRemoteMatches([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const radiusM = Math.round(Math.min(radiusKm, 50) * 1000);
        const escaped = escapeRegex(trimmed);
        const overpassQuery = `
[out:json][timeout:20];
(
  node["name"~"${escaped}","i"](around:${radiusM},${centerLat},${centerLon});
  way["name"~"${escaped}","i"](around:${radiusM},${centerLat},${centerLon});
);
out center tags;`.trim();

        const resp = await fetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: controller.signal,
        });

        const json = (await resp.json()) as { elements: OverpassElement[] };
        const localKeys = new Set(localMatches.map((m) => normalize(m.name)));
        const seen = new Set<string>(localKeys);
        const results: NearbyPlaceNameSuggestion[] = [];

        for (const el of json.elements) {
          const tags = el.tags ?? {};
          const name = tags["name"]?.trim();
          if (!name) continue;

          const elLat = el.lat ?? el.center?.lat;
          const elLon = el.lon ?? el.center?.lon;
          if (!Number.isFinite(elLat) || !Number.isFinite(elLon)) continue;

          const key = normalize(name);
          if (seen.has(key)) continue;
          seen.add(key);

          const address = buildAddress(tags) || name;
          results.push({ name, address, lat: elLat as number, lon: elLon as number });
        }

        setRemoteMatches(results.slice(0, 6));
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setRemoteMatches([]);
        }
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, enabled, localMatches.length, centerLat, centerLon, radiusKm]);

  const suggestions = useMemo(() => {
    const seen = new Set(localMatches.map((m) => normalize(m.name)));
    const extra = remoteMatches.filter((r) => !seen.has(normalize(r.name)));
    return [...localMatches, ...extra].slice(0, 6);
  }, [localMatches, remoteMatches]);

  return { suggestions, loading };
}

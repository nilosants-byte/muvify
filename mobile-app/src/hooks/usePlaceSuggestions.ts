import { useEffect, useRef, useState } from "react";

export type PlaceSuggestion = {
  /** Text shown in the suggestion list */
  displayName: string;
  /** Short venue name when the result is a named place (gym, park…); use to fill the "Nome do local" field */
  venueName?: string;
  lat: number;
  lon: number;
};

type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
  class: string;
  type: string;
  importance: number;
  name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    path?: string;
    footway?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
  };
};

// ─── State abbreviations ────────────────────────────────────────────────────
const STATE_ABBR: Record<string, string> = {
  "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM",
  "Bahia": "BA", "Ceará": "CE", "Distrito Federal": "DF", "Espírito Santo": "ES",
  "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
  "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ",
  "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", "Rondônia": "RO",
  "Roraima": "RR", "Santa Catarina": "SC", "São Paulo": "SP",
  "Sergipe": "SE", "Tocantins": "TO",
};

// ─── Fitness venue detection ─────────────────────────────────────────────────
const FITNESS_CLASS_TYPES: Array<{ class: string; type?: string }> = [
  { class: "leisure", type: "fitness_centre" },
  { class: "leisure", type: "sports_centre" },
  { class: "leisure", type: "pitch" },
  { class: "leisure", type: "stadium" },
  { class: "leisure", type: "track" },
  { class: "leisure", type: "swimming_pool" },
  { class: "leisure", type: "park" },
  { class: "leisure", type: "garden" },
  { class: "leisure", type: "recreation_ground" },
  { class: "leisure", type: "sports_hall" },
  { class: "amenity", type: "gym" },
  { class: "amenity", type: "fitness_centre" },
  { class: "amenity", type: "sports_centre" },
  { class: "amenity", type: "swimming_pool" },
  { class: "amenity", type: "dojo" },
  { class: "natural", type: "beach" },
  { class: "natural", type: "coastline" },
  { class: "place", type: "square" },
  { class: "highway", type: "pedestrian" },
];

function isFitnessVenue(r: NominatimResult): boolean {
  return FITNESS_CLASS_TYPES.some(
    (f) => r.class === f.class && (f.type === undefined || r.type === f.type)
  );
}

// Administrative/geographic boundaries are never useful as service locations
const SKIP_CLASSES = new Set(["boundary"]);
const SKIP_TYPES = new Set(["country", "state", "region", "county", "administrative"]);

// ─── Display formatters ──────────────────────────────────────────────────────

/**
 * Campo 1 — location mode: "Bairro, Cidade - SP"
 * Shows where the place is, not what it is.
 */
function formatAsLocation(item: NominatimResult): string {
  const a = item.address;
  if (!a) return item.display_name;

  const area =
    item.name ||
    a.suburb || a.neighbourhood || a.quarter || a.city_district;
  const city = a.city || a.town || a.village || a.municipality;
  const stateAbbr = a.state ? (STATE_ABBR[a.state] ?? a.state.slice(0, 2).toUpperCase()) : null;
  const cityWithState = city ? (stateAbbr ? `${city} - ${stateAbbr}` : city) : null;

  if (area && area !== city && cityWithState) return `${area}, ${cityWithState}`;
  if (cityWithState) return cityWithState;
  return item.display_name;
}

/**
 * Campo 3 — venue mode: "Academia X, Bairro, Cidade"
 * Shows what the place is, plus context.
 * Also returns a short venueName when the result is a named establishment.
 */
function formatAsVenue(item: NominatimResult): { displayName: string; venueName?: string } {
  const a = item.address;
  if (!a) return { displayName: item.display_name, venueName: item.name };

  const venueName = item.name?.trim() || undefined;
  const street = a.road || a.pedestrian || a.path || a.footway;
  const neighborhood = a.suburb || a.neighbourhood || a.quarter || a.city_district;
  const city = a.city || a.town || a.village || a.municipality;

  const parts: string[] = [];
  if (item.name) {
    parts.push(item.name);
  } else if (street) {
    const n = a.house_number;
    parts.push(n ? `${street}, ${n}` : street);
  }
  if (neighborhood) parts.push(neighborhood);
  if (city) parts.push(city);

  return {
    displayName: parts.length > 0 ? parts.join(", ") : item.display_name,
    venueName,
  };
}

// ─── Haversine ───────────────────────────────────────────────────────────────
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

function deduplicateByProximity<T extends { lat: number; lon: number }>(
  items: T[],
  minDistKm = 0.15
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const tooClose = kept.some(
      (k) => haversineKm(k.lat, k.lon, item.lat, item.lon) < minDistKm
    );
    if (!tooClose) kept.push(item);
  }
  return kept;
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function usePlaceSuggestions(
  query: string,
  userLat: number,
  userLng: number,
  enabled = true,
  debounceMs = 600,
  /** When true: boosts fitness venues and formats results as "VenueName, Neighborhood, City" */
  fitnessPriority = false,
  /** When set, filters out results beyond this distance from the user (km) */
  maxDistKm?: number
) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    if (!enabled || trimmed.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(trimmed)}` +
          `&format=json&limit=15&countrycodes=br&addressdetails=1`;

        const resp = await fetch(url, {
          signal: controller.signal,
          headers: {
            "Accept-Language": "pt-BR,pt;q=0.9",
            "User-Agent": "Muvify-App/1.0",
          },
        });

        const raw = (await resp.json()) as NominatimResult[];

        const candidates = raw
          .filter((r) => {
            const lat = parseFloat(r.lat);
            const lon = parseFloat(r.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
            if (SKIP_CLASSES.has(r.class) && SKIP_TYPES.has(r.type)) return false;
            return true;
          })
          .map((r) => {
            const lat = parseFloat(r.lat);
            const lon = parseFloat(r.lon);
            const dist = haversineKm(userLat, userLng, lat, lon);
            const fitness = isFitnessVenue(r);
            const formatted = fitnessPriority
              ? formatAsVenue(r)
              : { displayName: formatAsLocation(r), venueName: undefined };

            return {
              displayName: formatted.displayName,
              venueName: formatted.venueName,
              lat,
              lon,
              _dist: dist,
              // Fitness venues get 4× distance advantage in fitness-priority mode
              _score: fitnessPriority && fitness ? dist * 0.25 : dist,
            };
          })
          .filter((r) => maxDistKm === undefined || r._dist <= maxDistKm)
          .sort((a, b) => a._score - b._score);

        const deduped = deduplicateByProximity(candidates);

        const seen = new Set<string>();
        const final = deduped
          .filter((r) => {
            if (seen.has(r.displayName)) return false;
            seen.add(r.displayName);
            return true;
          })
          .slice(0, 5)
          .map(({ _dist: _, _score: __, ...rest }) => rest);

        setSuggestions(final);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [query, userLat, userLng, enabled, debounceMs, fitnessPriority, maxDistKm]);

  return { suggestions, loading, clear: () => setSuggestions([]) };
}

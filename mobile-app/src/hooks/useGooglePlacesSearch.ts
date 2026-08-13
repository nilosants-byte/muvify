import { useEffect, useRef, useState } from "react";
import { captureException, captureMessage } from "../observability/sentry";

export type GooglePlaceSuggestion = {
  name: string;
  address: string;
  lat: number;
  lon: number;
  placeId?: string;
};

type AutocompletePrediction = {
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  description: string;
};

type AutocompleteResponse = {
  status: string;
  predictions?: AutocompletePrediction[];
};

type PlaceDetailsResponse = {
  status: string;
  result?: {
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  };
};

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ?? "";
const AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

/**
 * Fetches lat/lon for a place_id returned by autocomplete.
 * Called only when the user actually selects a suggestion.
 */
export async function fetchGooglePlaceCoords(
  placeId: string
): Promise<{ lat: number; lon: number; address: string } | null> {
  if (!API_KEY || !placeId) return null;
  try {
    const url =
      `${DETAILS_URL}` +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&fields=geometry,formatted_address` +
      `&language=pt-BR` +
      `&key=${API_KEY}`;
    const resp = await fetch(url);
    const json = (await resp.json()) as PlaceDetailsResponse;
    if (json.status !== "OK" || !json.result?.geometry?.location) {
      if (__DEV__) console.warn("[GooglePlaces] details error:", json.status);
      // Frente 13 (segunda camada), Lote 17: status de erro da API (chave
      // revogada, billing cortado, etc.) só era logado em __DEV__ — em
      // produção, se a chave quebrar, a busca de endereço some pra todos
      // os usuários sem nenhum sinal.
      if (json.status !== "ZERO_RESULTS") {
        captureMessage(`[GooglePlaces] details error: ${json.status}`, "warning");
      }
      return null;
    }
    const loc = json.result.geometry.location;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    return {
      lat: loc.lat as number,
      lon: loc.lng as number,
      address: json.result.formatted_address ?? "",
    };
  } catch (error) {
    captureException(error, { stage: "google_places_details" });
    return null;
  }
}

/**
 * Campo 2 / Campo 3 — Google Places Autocomplete.
 *
 * Returns suggestions without coordinates (lat=0, lon=0).
 * When the user selects a suggestion, call fetchGooglePlaceCoords(placeId)
 * to resolve the actual coordinates in a single Place Details request.
 *
 * Falls back gracefully when EXPO_PUBLIC_GOOGLE_PLACES_KEY is not configured.
 * Logs the API status to console when Google rejects the request (e.g. billing
 * not set up, wrong key restrictions), making silent failures visible.
 */
export function useGooglePlacesSearch(
  query: string,
  lat: number,
  lon: number,
  radiusKm: number,
  enabled: boolean,
  /** Passed as `types` to the Autocomplete API. Empty string omits the param (returns all types). Default: "establishment" */
  types = "establishment"
): { suggestions: GooglePlaceSuggestion[]; loading: boolean; hasError: boolean } {
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    if (!API_KEY) {
      setSuggestions([]);
      setLoading(false);
      setHasError(true);
      return;
    }
    if (!enabled || trimmed.length < 2) {
      setSuggestions([]);
      setHasError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setHasError(false);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const radiusM = Math.min(Math.round(radiusKm * 1000), 50000);
        const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
        const url =
          `${AUTOCOMPLETE_URL}` +
          `?input=${encodeURIComponent(trimmed)}` +
          `&location=${lat},${lon}` +
          `&radius=${radiusM}` +
          `&language=pt-BR` +
          typesParam +
          `&key=${API_KEY}`;

        const resp = await fetch(url, { signal: controller.signal });
        const json = (await resp.json()) as AutocompleteResponse;

        if (controller.signal.aborted) return;
        if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
          if (__DEV__) console.warn("[GooglePlaces] autocomplete error:", json.status);
          // Frente 13 (segunda camada), Lote 17: mesmo achado do
          // details acima — status de erro só aparecia em dev.
          captureMessage(`[GooglePlaces] autocomplete error: ${json.status}`, "warning");
          setSuggestions([]);
          if (json.status === "REQUEST_DENIED" || json.status === "INVALID_REQUEST") {
            setHasError(true);
          }
          return;
        }

        const results: GooglePlaceSuggestion[] = (json.predictions ?? [])
          .map((p) => ({
            name: p.structured_formatting.main_text.trim(),
            address: (p.structured_formatting.secondary_text ?? p.description).trim(),
            lat: 0,
            lon: 0,
            placeId: p.place_id,
          }))
          .filter((r) => r.name)
          .slice(0, 6);

        setSuggestions(results);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setSuggestions([]);
          setHasError(true);
          captureException(err, { stage: "google_places_autocomplete" });
        }
      } finally {
        setLoading(false);
      }
    }, 600);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, lat, lon, radiusKm, enabled, types]);

  return { suggestions, loading, hasError };
}

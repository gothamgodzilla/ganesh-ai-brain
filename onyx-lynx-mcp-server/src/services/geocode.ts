import { OpenLocationCode } from "open-location-code";
import { httpGet } from "./http.js";
import { GOOGLE_GEOCODE_URL } from "../constants.js";
import type { ResolvedLocation } from "../types.js";

const olc = new OpenLocationCode();

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
}

function requireGoogleKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set. Get one at https://console.cloud.google.com/google/maps-apis " +
        "with the Geocoding API and Places API enabled, then add it to your environment. " +
        "(This is the same key used by onyx_search_google_places.)"
    );
  }
  return key;
}

export async function resolveZipCode(zip: string): Promise<ResolvedLocation> {
  const key = requireGoogleKey();
  const data = await httpGet<GoogleGeocodeResponse>(GOOGLE_GEOCODE_URL, {
    address: zip,
    components: "country:US",
    key,
  });
  if (data.status !== "OK" || !data.results.length) {
    throw new Error(
      `Could not geocode zip code "${zip}" (Google status: ${data.status}${
        data.error_message ? ` — ${data.error_message}` : ""
      }).`
    );
  }
  const top = data.results[0];
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formatted_address: top.formatted_address,
    source: "zip_code",
    input: zip,
  };
}

export function resolveGlobalCode(code: string): ResolvedLocation {
  const trimmed = code.trim();
  if (!olc.isFull(trimmed)) {
    throw new Error(
      `"${code}" looks like a short Open Location Code (Plus Code), which needs a reference ` +
        `location to resolve (e.g. a city). Pass the full code instead (starts with the 2-4-4 grid, ` +
        `e.g. "849VCWC8+R9"), or resolve by zip_code instead.`
    );
  }
  const area = olc.decode(trimmed);
  return {
    lat: area.latitudeCenter,
    lng: area.longitudeCenter,
    formatted_address: `Decoded Plus Code area centered at ${area.latitudeCenter.toFixed(
      5
    )}, ${area.longitudeCenter.toFixed(5)}`,
    source: "global_code",
    input: code,
  };
}

export function milesToMeters(miles: number): number {
  return Math.round(miles * 1609.344);
}

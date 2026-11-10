import jwt from "jsonwebtoken";
import { httpGet } from "./http.js";
import { APPLE_MAPS_TOKEN_URL, APPLE_MAPS_SEARCH_URL } from "../constants.js";

/**
 * Apple Maps Server API auth is JWT-based, not a simple static API key:
 *   1. Sign a short-lived ES256 "Maps Token" JWT with your Apple Developer
 *      Team ID + MapKit Key ID + the matching .p8 private key.
 *   2. Exchange it once for a short-lived server access token.
 *   3. Use that access token as a Bearer token on Maps Server API calls
 *      (Search, Geocode, ETA, etc).
 *
 * Per your masterlist (MASTERLIST.md), you already have everything needed:
 *   APPLE_TEAM_ID                -> 854XZ2543V
 *   APPLE_MAPKIT_KEY_ID          -> the Key ID for a MapKit-enabled key (NOT the AI Build APNs key)
 *   APPLE_MAPKIT_P8_PATH         -> path to the matching AuthKey_*.p8
 *
 * This module intentionally reads the .p8 from a file path (never inline
 * PEM text in env vars) and never logs the signed JWT or access token.
 */

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function requireAppleEnv(): { teamId: string; keyId: string; p8Path: string } {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const p8Path = process.env.APPLE_MAPKIT_P8_PATH;
  if (!teamId || !keyId || !p8Path) {
    throw new Error(
      "Apple Maps Server API is not configured. Set APPLE_TEAM_ID, APPLE_MAPKIT_KEY_ID, and " +
        "APPLE_MAPKIT_P8_PATH (path to the MapKit-enabled AuthKey_*.p8 from your Apple Developer " +
        "account — see MASTERLIST.md). Note this must be a key with the MapKit JS/Server service " +
        "enabled; the 'AI Build' APNs key (3MPBZVJFKG) is a different key and will not work."
    );
  }
  return { teamId, keyId, p8Path };
}

async function getMapsAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }

  const { teamId, keyId, p8Path } = requireAppleEnv();
  const fs = await import("node:fs/promises");
  const privateKey = await fs.readFile(p8Path, "utf8");

  const mapsToken = jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: teamId,
    keyid: keyId,
    expiresIn: "30m",
  });

  const data = await httpGet<{ accessToken: string; expiresInSeconds: number }>(
    APPLE_MAPS_TOKEN_URL,
    undefined,
    { Authorization: `Bearer ${mapsToken}` }
  );

  cachedAccessToken = {
    token: data.accessToken,
    expiresAt: Date.now() + data.expiresInSeconds * 1000,
  };
  return cachedAccessToken.token;
}

export interface AppleMapsSearchResult {
  name: string;
  formattedAddressLines?: string[];
  coordinate?: { latitude: number; longitude: number };
  poiCategory?: string;
  displayMapRegion?: unknown;
}

export async function searchAppleMaps(params: {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  limit?: number;
}): Promise<AppleMapsSearchResult[]> {
  const accessToken = await getMapsAccessToken();
  const data = await httpGet<{ results?: AppleMapsSearchResult[] }>(
    APPLE_MAPS_SEARCH_URL,
    {
      q: params.query,
      searchLocation: `${params.lat},${params.lng}`,
      searchRegion: `${params.lat},${params.lng},${params.radiusMeters}`,
      limitToCountries: "US",
      resultTypeFilter: "Poi",
    },
    { Authorization: `Bearer ${accessToken}` }
  );
  return data.results ?? [];
}

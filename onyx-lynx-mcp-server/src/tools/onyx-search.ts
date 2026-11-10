import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { httpGet, handleApiError, truncate, asStructured } from "../services/http.js";
import { resolveZipCode, resolveGlobalCode, milesToMeters } from "../services/geocode.js";
import { searchAppleMaps } from "../services/apple-maps.js";
import { mergeBusinessRecords } from "../services/matching.js";
import {
  ResolveLocationInputSchema,
  SearchGooglePlacesInputSchema,
  SearchAppleMapsInputSchema,
  SearchYelpInputSchema,
  VerifyWhitepagesInputSchema,
  StateRegistryLinkInputSchema,
  MergeBusinessRecordsInputSchema,
} from "../schemas/onyx.js";
import {
  GOOGLE_PLACES_NEARBY_URL,
  YELP_BUSINESS_SEARCH_URL,
  CHARACTER_LIMIT,
  US_STATE_SOS_BUSINESS_SEARCH,
} from "../constants.js";
import type { BusinessRecord } from "../types.js";

export function registerOnyxTools(server: McpServer): void {
  server.registerTool(
    "onyx_resolve_location",
    {
      title: "Onyx: Resolve Zip Code or Global Code",
      description: `Turn a U.S. zip code or a Google Plus Code (Open Location Code / "global code") into a lat/lng center point for radius search.

Args:
  - zip_code (string, optional): 5-digit or ZIP+4 U.S. zip code. Provide this OR global_code.
  - global_code (string, optional): full Open Location Code, e.g. "849VCWC8+R9".

Returns: { lat, lng, formatted_address, source, input }

Use when: kicking off a "Sleepy Hollow" sweep — this is always the first call before onyx_search_*.
Don't use when: you already have lat/lng from a prior call.

Error Handling:
  - Throws if neither or both of zip_code/global_code are provided (schema-enforced).
  - Returns "Error: ..." text if Google geocoding fails or GOOGLE_MAPS_API_KEY is unset.`,
      inputSchema: ResolveLocationInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const result = params.zip_code
          ? await resolveZipCode(params.zip_code)
          : resolveGlobalCode(params.global_code!);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: asStructured(result),
        };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? `Error: ${error.message}` : String(error) }] };
      }
    }
  );

  server.registerTool(
    "onyx_search_google_places",
    {
      title: "Onyx: Search Google Places",
      description: `Search Google Places (Nearby Search) for businesses matching a category within a radius of a center point.

Args:
  - lat, lng (number): center point, from onyx_resolve_location.
  - radius_miles (number, 1-100, default 25): search radius.
  - category_keyword (string): e.g. "barber shop", "landscaping company", "law firm".
  - max_results (number, 1-60, default 20): capped by Google at 60 across 3 pages of 20.

Returns JSON: { count, results: BusinessRecord[] } — each record has source="google_places",
source_id (Google place_id), name, category, address, lat/lng, rating, review_count.

Use when: doing the primary fleet sweep for a category around a zip/global code.
Requires: GOOGLE_MAPS_API_KEY env var (Places API + Geocoding API enabled).

Error Handling:
  - "Error: ... auth/permission" if the key is missing/invalid/API not enabled.
  - "Error: ... rate limit" (429) — reduce radius or add delay between category sweeps.`,
      inputSchema: SearchGooglePlacesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) {
        return {
          content: [{ type: "text", text: "Error: GOOGLE_MAPS_API_KEY is not set. See README setup steps." }],
        };
      }
      try {
        const data = await httpGet<any>(GOOGLE_PLACES_NEARBY_URL, {
          location: `${params.lat},${params.lng}`,
          radius: milesToMeters(params.radius_miles),
          keyword: params.category_keyword,
          key,
        });
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          return {
            content: [{ type: "text", text: `Error: Google Places status ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}` }],
          };
        }
        const results: BusinessRecord[] = (data.results ?? [])
          .slice(0, params.max_results)
          .map((r: any) => ({
            source: "google_places",
            source_id: r.place_id,
            name: r.name,
            category: params.category_keyword,
            address: r.vicinity,
            lat: r.geometry?.location?.lat,
            lng: r.geometry?.location?.lng,
            rating: r.rating,
            review_count: r.user_ratings_total,
            price_level: r.price_level !== undefined ? String(r.price_level) : undefined,
          }));
        const output = { count: results.length, results };
        const { text, truncated } = truncate(JSON.stringify(output, null, 2), CHARACTER_LIMIT);
        return {
          content: [{ type: "text", text: truncated ? `${text}\n... [truncated, ${results.length} total — narrow category_keyword or radius]` : text }],
          structuredContent: asStructured(output),
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error, "Google Places") }] };
      }
    }
  );

  server.registerTool(
    "onyx_search_apple_maps",
    {
      title: "Onyx: Search Apple Maps",
      description: `Search Apple Maps Server API for businesses/POIs matching a category within a radius.

Args:
  - lat, lng (number): center point.
  - radius_miles (number, 1-100, default 25).
  - category_keyword (string).

Returns JSON: { count, results: BusinessRecord[] } with source="apple_maps".

Requires: APPLE_TEAM_ID, APPLE_MAPKIT_KEY_ID, APPLE_MAPKIT_P8_PATH (see MASTERLIST.md — you
already have Apple Developer credentials; confirm the key used has the MapKit/Server API service
enabled, not just APNs).

Error Handling:
  - "Error: Apple Maps Server API is not configured..." if env vars are missing.
  - "Error: ... auth/permission" if the JWT signing key lacks the MapKit service.`,
      inputSchema: SearchAppleMapsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const raw = await searchAppleMaps({
          query: params.category_keyword,
          lat: params.lat,
          lng: params.lng,
          radiusMeters: milesToMeters(params.radius_miles),
        });
        const results: BusinessRecord[] = raw.map((r, i) => ({
          source: "apple_maps",
          source_id: `${r.name}-${i}`,
          name: r.name,
          category: r.poiCategory ?? params.category_keyword,
          address: r.formattedAddressLines?.join(", "),
          lat: r.coordinate?.latitude,
          lng: r.coordinate?.longitude,
        }));
        const output = { count: results.length, results };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: asStructured(output),
        };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? `Error: ${error.message}` : String(error) }] };
      }
    }
  );

  server.registerTool(
    "onyx_search_yelp",
    {
      title: "Onyx: Search Yelp",
      description: `Search Yelp Fusion for businesses matching a category near a zip code or lat/lng.

Args:
  - zip_code (string, optional) OR lat+lng (number, optional) — one of the two is required.
  - radius_miles (number, 1-25, default 15) — Yelp caps radius at ~25 miles.
  - category_keyword (string).
  - max_results (number, 1-50, default 20).

Returns JSON: { count, results: BusinessRecord[] } with source="yelp", including rating and
review_count pulled directly from Yelp's public review data.

Requires: YELP_API_KEY env var (already in your masterlist as YELP_API_KEY / MANGASM_YELP_API_KEY).

Error Handling:
  - "Error: ... auth/permission" (401) if the key is invalid.
  - "Error: ... rate limit" (429) — Yelp Fusion free tier is call-limited; batch by category.`,
      inputSchema: SearchYelpInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const key = process.env.YELP_API_KEY;
      if (!key) {
        return { content: [{ type: "text", text: "Error: YELP_API_KEY is not set. See README setup steps." }] };
      }
      try {
        const data = await httpGet<any>(
          YELP_BUSINESS_SEARCH_URL,
          {
            location: params.zip_code,
            latitude: params.lat,
            longitude: params.lng,
            radius: milesToMeters(params.radius_miles),
            term: params.category_keyword,
            limit: params.max_results,
          },
          { Authorization: `Bearer ${key}` }
        );
        const results: BusinessRecord[] = (data.businesses ?? []).map((b: any) => ({
          source: "yelp",
          source_id: b.id,
          name: b.name,
          category: b.categories?.[0]?.title ?? params.category_keyword,
          address: b.location?.display_address?.join(", "),
          phone: b.display_phone,
          website: b.url,
          lat: b.coordinates?.latitude,
          lng: b.coordinates?.longitude,
          rating: b.rating,
          review_count: b.review_count,
          price_level: b.price,
          raw_url: b.url,
        }));
        const output = { count: results.length, results };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: asStructured(output),
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error, "Yelp Fusion") }] };
      }
    }
  );

  server.registerTool(
    "onyx_verify_whitepages_business",
    {
      title: "Onyx: Verify Business (WhitePages) [STUB]",
      description: `STUB — WhitePages does not publish a general-purpose "business search by category/zip" API;
their public product line (Identity Check / Pro) is oriented around verifying an individual
person or a specific known phone number, not bulk business discovery. Wiring this in for real
would mean using it ONLY to sanity-check a phone number you already got from Places/Yelp/Apple —
never as a standalone people-search step, to stay inside the "public business data only, no
private-data harvest" rule in your own MASTER-GOALS.md.

Args:
  - business_name (string): the business you're verifying.
  - phone (string, optional): phone number to check, if you have one from another source.

Returns: an explanatory message and next-step guidance — this tool intentionally does NOT call
a live API yet. Implement services/whitepages.ts once you've picked a specific verification
product (e.g. WhitePages Pro phone reputation) and gotten a key, then flip this stub over.`,
      inputSchema: VerifyWhitepagesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      return {
        content: [
          {
            type: "text",
            text:
              `Not implemented: no WHITEPAGES_API_KEY configured, and no confirmed WhitePages ` +
              `endpoint for bulk business search exists. For "${params.business_name}"` +
              (params.phone ? ` (phone ${params.phone})` : "") +
              `, use the phone/address already returned by onyx_search_yelp or onyx_search_google_places ` +
              `as your verified contact point instead. If you specifically want carrier/line-type ` +
              `validation for a phone number before emailing, consider a phone-lookup API (e.g. Twilio ` +
              `Lookup) rather than WhitePages, and wire it in here.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "onyx_get_state_registry_link",
    {
      title: "Onyx: Get State Business Registry Link",
      description: `Return the correct Secretary of State (or equivalent) business-entity search URL for a state,
so "confirmed with the state" can be a manual (or later browser-automated) verification step.
There is no single unified API across all 50 states — this is a static lookup table, not a
live query.

Args:
  - state (string): two-letter state code, e.g. "CA".

Returns: { state, url } or an error if the code isn't recognized.`,
      inputSchema: StateRegistryLinkInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const url = US_STATE_SOS_BUSINESS_SEARCH[params.state];
      if (!url) {
        return { content: [{ type: "text", text: `Error: No registry URL on file for state "${params.state}".` }] };
      }
      const output = { state: params.state, url };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: asStructured(output) };
    }
  );

  server.registerTool(
    "onyx_merge_business_records",
    {
      title: "Onyx: Merge/Dedupe Business Records",
      description: `Merge business records pooled from onyx_search_google_places / onyx_search_apple_maps /
onyx_search_yelp into one record per real-world storefront (fuzzy name + address match), so
downstream pitch generation and Lynx outreach send exactly one email per business instead of
one per data source.

Args:
  - records (BusinessRecord[]): pooled results from the onyx_search_* tools.

Returns JSON: { count, merged: MergedBusinessRecord[] } — each merged record lists which sources
confirmed it, all known addresses/phones/websites, and combined review signal.`,
      inputSchema: MergeBusinessRecordsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const merged = mergeBusinessRecords(params.records as BusinessRecord[]);
      const output = { count: merged.length, merged };
      const { text, truncated } = truncate(JSON.stringify(output, null, 2), CHARACTER_LIMIT);
      return {
        content: [{ type: "text", text: truncated ? `${text}\n... [truncated]` : text }],
        structuredContent: asStructured(output),
      };
    }
  );
}

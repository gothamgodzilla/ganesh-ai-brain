import { z } from "zod";

export const ResolveLocationInputSchema = z
  .object({
    zip_code: z
      .string()
      .regex(/^\d{5}(-\d{4})?$/, "Must be a 5-digit or ZIP+4 U.S. zip code")
      .optional()
      .describe("U.S. zip code, e.g. '90802'. Provide this OR global_code, not both."),
    global_code: z
      .string()
      .min(4)
      .max(11)
      .optional()
      .describe(
        "Google Open Location Code / 'Plus Code', e.g. '849VCWC8+R9' (full) or " +
          "'CWC8+R9 Long Beach, CA' (short form needs a reference location — prefer full codes)."
      ),
  })
  .strict()
  .refine((v) => Boolean(v.zip_code) !== Boolean(v.global_code), {
    message: "Provide exactly one of zip_code or global_code.",
  });
export type ResolveLocationInput = z.infer<typeof ResolveLocationInputSchema>;

const RADIUS_DESC =
  "Search radius in miles from the resolved center point (5-100). The business scope in scale " +
  "is bars/salons/barbershops/dispensaries/nightclubs/contractors/legal & insurance firms etc. — " +
  "use radius + category to bound the sweep, not an unbounded scrape.";

export const SearchGooglePlacesInputSchema = z
  .object({
    lat: z.number().min(-90).max(90).describe("Center latitude (from onyx_resolve_location)."),
    lng: z.number().min(-180).max(180).describe("Center longitude (from onyx_resolve_location)."),
    radius_miles: z.number().min(1).max(100).default(25).describe(RADIUS_DESC),
    category_keyword: z
      .string()
      .min(2)
      .max(100)
      .describe(
        "Business category/type to search, e.g. 'bar', 'hair salon', 'barber shop', 'art studio', " +
          "'dance studio', 'dispensary', 'nightclub', 'general contractor', 'landscaping company', " +
          "'interior design firm', 'law firm', 'insurance agency'."
      ),
    max_results: z.number().int().min(1).max(60).default(20).describe("Max results (Google returns up to 60 across 3 pages)."),
  })
  .strict();
export type SearchGooglePlacesInput = z.infer<typeof SearchGooglePlacesInputSchema>;

export const SearchAppleMapsInputSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_miles: z.number().min(1).max(100).default(25).describe(RADIUS_DESC),
    category_keyword: z.string().min(2).max(100),
  })
  .strict();
export type SearchAppleMapsInput = z.infer<typeof SearchAppleMapsInputSchema>;

export const SearchYelpInputSchema = z
  .object({
    zip_code: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius_miles: z.number().min(1).max(25).default(15).describe(
      "Yelp Fusion caps radius at 40,000m (~25mi) — larger sweeps should paginate across " +
        "multiple zip-centered calls instead."
    ),
    category_keyword: z.string().min(2).max(100),
    max_results: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((v) => Boolean(v.zip_code) || (v.lat !== undefined && v.lng !== undefined), {
    message: "Provide either zip_code, or both lat and lng.",
  });
export type SearchYelpInput = z.infer<typeof SearchYelpInputSchema>;

export const VerifyWhitepagesInputSchema = z
  .object({
    business_name: z.string().min(1).max(200),
    phone: z.string().min(7).max(20).optional().describe("E.164 or US-formatted phone to verify, if known."),
  })
  .strict();
export type VerifyWhitepagesInput = z.infer<typeof VerifyWhitepagesInputSchema>;

export const StateRegistryLinkInputSchema = z
  .object({
    state: z
      .string()
      .length(2)
      .transform((s) => s.toUpperCase())
      .describe("Two-letter US state code (or 'DC'), e.g. 'CA', 'TX'."),
  })
  .strict();
export type StateRegistryLinkInput = z.infer<typeof StateRegistryLinkInputSchema>;

export const MergeBusinessRecordsInputSchema = z
  .object({
    records: z
      .array(
        z.object({
          source: z.enum(["google_places", "apple_maps", "yelp"]),
          source_id: z.string(),
          name: z.string(),
          category: z.string().optional(),
          address: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          rating: z.number().optional(),
          review_count: z.number().optional(),
          price_level: z.string().optional(),
          raw_url: z.string().optional(),
        })
      )
      .min(1)
      .max(300)
      .describe("Business records previously returned by onyx_search_* tools, pooled together."),
  })
  .strict();
export type MergeBusinessRecordsInput = z.infer<typeof MergeBusinessRecordsInputSchema>;

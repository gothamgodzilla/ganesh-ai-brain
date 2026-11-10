// Shared type definitions for the Onyx & Lynx MCP server.

export interface ResolvedLocation {
  lat: number;
  lng: number;
  formatted_address: string;
  source: "zip_code" | "global_code";
  input: string;
}

export interface BusinessRecord {
  source: "google_places" | "apple_maps" | "yelp";
  source_id: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  review_count?: number;
  price_level?: string;
  raw_url?: string;
}

export interface MergedBusinessRecord {
  canonical_name: string;
  addresses: string[];
  phones: string[];
  websites: string[];
  sources: BusinessRecord["source"][];
  best_rating?: number;
  total_review_count?: number;
  records: BusinessRecord[];
}

export interface LeadRecord {
  business_id: string; // stable id you assign (e.g. normalized name+zip, or a Places place_id)
  business_name: string;
  contact_email?: string;
  status: "new" | "contacted" | "opted_out" | "converted" | "expired";
  first_contacted_at?: string; // ISO timestamp
  last_contacted_at?: string; // ISO timestamp
  contact_count: number;
  preview_expires_at?: string; // ISO timestamp
  notes?: string;
}

export interface LeadStore {
  leads: Record<string, LeadRecord>;
}

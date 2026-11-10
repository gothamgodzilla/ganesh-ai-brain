// Shared constants for the Onyx & Lynx MCP server.

export const CHARACTER_LIMIT = 25000;

// --- Onyx (discovery) endpoints ---
export const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
export const GOOGLE_PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
export const GOOGLE_PLACES_TEXT_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
export const GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export const APPLE_MAPS_TOKEN_URL = "https://maps-api.apple.com/v1/token";
export const APPLE_MAPS_SEARCH_URL = "https://maps-api.apple.com/v1/search";

export const YELP_BUSINESS_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";

// --- Lynx (outreach) endpoints ---
export const RESEND_SEND_URL = "https://api.resend.com/emails";

// Allowlisted "From" senders. Anything not in this list is rejected before
// a Resend call is ever made — this is the guardrail against a bad prompt
// (or a compromised agent) sending mail as an unverified/unintended address.
export const ALLOWED_FROM_ADDRESSES = [
  "Hello@Ganesh.Guru",
  "ceo@ganesh.guru",
  "ai@mangasm.app",
  "admin@Ganesh.guru",
] as const;

// CAN-SPAM (15 U.S.C. § 7704) requires, for every commercial email:
//  - accurate header/from information (enforced via ALLOWED_FROM_ADDRESSES)
//  - a non-deceptive subject line
//  - clear identification as an advertisement (most states also expect this)
//  - a valid physical postal address
//  - a working opt-out mechanism, honored within 10 business days
// This server will not send an email that is missing the footer or the
// opt-out link — see services/compliance.ts.
export const DEFAULT_PREVIEW_EXPIRY_DAYS = 14;

export const LEAD_STORE_PATH = "./data/leads.json";

export const US_STATE_SOS_BUSINESS_SEARCH: Record<string, string> = {
  AL: "https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT",
  AK: "https://www.commerce.alaska.gov/cbp/main/search/entities",
  AZ: "https://ecorp.azcc.gov/EntitySearch/Index",
  AR: "https://www.sos.arkansas.gov/corps/search_all.php",
  CA: "https://bizfileonline.sos.ca.gov/search/business",
  CO: "https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do",
  CT: "https://service.ct.gov/business/s/onlinebusinesssearch",
  DE: "https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx",
  FL: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
  GA: "https://ecorp.sos.ga.gov/BusinessSearch",
  HI: "https://hbe.ehawaii.gov/documents/search.html",
  ID: "https://sosbiz.idaho.gov/search/business",
  IL: "https://apps.ilsos.gov/businessentitysearch/",
  IN: "https://bsd.sos.in.gov/publicbusinesssearch",
  IA: "https://sos.iowa.gov/search/business/search.aspx",
  KS: "https://www.kansas.gov/bess/flow/main?execution=e1s1",
  KY: "https://web.sos.ky.gov/bussearchnprofile/",
  LA: "https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx",
  ME: "https://icrs.informe.org/nei-sos-icrs/ICRS",
  MD: "https://egov.maryland.gov/BusinessExpress/EntitySearch",
  MA: "https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx",
  MI: "https://cofs.lara.state.mi.us/SearchApi/Search/Search",
  MN: "https://mblsportal.sos.state.mn.us/Business/Search",
  MS: "https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx",
  MO: "https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx",
  MT: "https://biz.sosmt.gov/search/business",
  NE: "https://www.nebraska.gov/sos/corp/corpsearch.cgi",
  NV: "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
  NH: "https://quickstart.sos.nh.gov/online/BusinessInquire",
  NJ: "https://www.njportal.com/DOR/BusinessNameSearch/",
  NM: "https://enterprise.sos.nm.gov/search/business",
  NY: "https://apps.dos.ny.gov/publicInquiry/",
  NC: "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration",
  ND: "https://firststop.sos.nd.gov/search",
  OH: "https://businesssearch.ohiosos.gov/",
  OK: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
  OR: "https://sos.oregon.gov/business/Pages/find.aspx",
  PA: "https://file.dos.pa.gov/search/business",
  RI: "https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx",
  SC: "https://businessfilings.sc.gov/BusinessFiling/Entity/Search",
  SD: "https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx",
  TN: "https://tnbear.tn.gov/ECommerce/RequestSearch.aspx",
  TX: "https://mycpa.cpa.state.tx.us/coa/",
  UT: "https://secure.utah.gov/bes/",
  VT: "https://bizfilings.vermont.gov/online/BusinessInquire/",
  VA: "https://cis.scc.virginia.gov/EntitySearch/Index",
  WA: "https://ccfs.sos.wa.gov/#/BusinessSearch",
  WV: "https://apps.sos.wv.gov/business/corporations/",
  WI: "https://apps.dfi.wi.gov/apps/corpsearch/Search.aspx",
  WY: "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
  DC: "https://corponline.dcra.dc.gov/Home.aspx/Search",
};

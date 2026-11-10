/**
 * GEO trade pipeline — generates localized schema.org Product JSON-LD per
 * target language. Language set is a constructor parameter so 10-language
 * and 170-language runs are configs, not separate codebases.
 */

/** Top 10 global trade languages (default fleet). */
export const TRADE_LANGUAGES = {
  en: 'English',
  zh: 'Mandarin',
  es: 'Spanish',
  de: 'German',
  ja: 'Japanese',
  fr: 'French',
  ar: 'Arabic',
  pt: 'Portuguese',
  hi: 'Hindi',
  ko: 'Korean',
};

export class GaneshTradeEngine {
  /**
   * @param {object} [options]
   * @param {Record<string,string>} [options.languages] ISO code → name map.
   * @param {(text: string, langCode: string) => string} [options.translate]
   *   Translation function; defaults to a tagging stub until the local
   *   translation model is wired in.
   */
  constructor({ languages = TRADE_LANGUAGES, translate } = {}) {
    this.languages = languages;
    this.translate = translate ?? ((text, langCode) => `[${langCode.toUpperCase()}] ${text}`);
  }

  /**
   * Build one localized schema.org Product entry.
   * The seller carries the business telephone so downstream contact-fidelity
   * gates can compare it against the registry record. Price is emitted only
   * when the SKU actually has one — a missing price must never serialize as
   * the string "None"/"undefined".
   */
  buildSchemaOrg(business, sku, langCode, transName, transDesc) {
    const offer = {
      '@type': 'Offer',
      priceCurrency: sku.priceCurrency ?? 'USD',
      availability: sku.availability ?? 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: business.legal_name,
        identifier: business.ganesh_trust_hash,
        ...(business.phone ? { telephone: business.phone } : {}),
      },
    };
    if (sku.price !== undefined && sku.price !== null && sku.price !== '') {
      offer.price = String(sku.price);
    }
    return {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      inLanguage: langCode,
      name: transName,
      description: transDesc,
      sku: sku.sku_code,
      brand: { '@type': 'Brand', name: business.legal_name },
      offers: offer,
    };
  }

  /**
   * Process a SKU batch across every configured language.
   * @returns {Record<string, object[]>} language code → localized schemas.
   */
  processTradeBatch(business, skus) {
    const manifest = {};
    for (const langCode of Object.keys(this.languages)) {
      manifest[langCode] = skus.map((item) =>
        this.buildSchemaOrg(
          business,
          item,
          langCode,
          this.translate(item.item_name, langCode),
          this.translate(item.description, langCode),
        ),
      );
    }
    return manifest;
  }
}

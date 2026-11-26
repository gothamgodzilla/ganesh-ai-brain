export const DEFAULT_WATCHDOG_PROPERTIES = Object.freeze([
  {
    domain: 'mangasm.app',
    name: 'Mangasm',
    endpoints: ['https://mangasm.app/'],
  },
  {
    domain: 'ganesh.guru',
    name: 'Ganesh Guru Brain',
    endpoints: ['https://ganesh.guru/', 'https://ganesh.guru/api/healthz'],
  },
  {
    domain: 'coexist.llc',
    name: 'Coexist LLC',
    endpoints: ['https://coexist.llc/'],
  },
  {
    domain: 'coexist.click',
    name: 'Coexist Click',
    endpoints: ['https://coexist.click/'],
  },
  {
    domain: 'nostalgia.sh',
    name: 'Nostalgia.sh',
    endpoints: ['https://nostalgia.sh/'],
  },
  {
    domain: 'lynxlogix.ai',
    name: 'LynxLogix AI',
    endpoints: ['https://lynxlogix.ai/'],
  },
  {
    domain: 'lynxlogix.net',
    name: 'LynxLogix Net',
    endpoints: ['https://lynxlogix.net/'],
  },
  {
    domain: 'lynxlogix.org',
    name: 'LynxLogix Org',
    endpoints: ['https://lynxlogix.org/'],
  },
  {
    domain: 'helping.llc',
    name: 'Helping LLC',
    endpoints: ['https://helping.llc/'],
  },
  {
    domain: 'slay.llc',
    name: 'Slay LLC',
    endpoints: ['https://slay.llc/'],
  },
]);

export const DEFAULT_WATCHDOG_THRESHOLDS = Object.freeze({
  slowLatencyMs: 2500,
  tlsExpiryWarnDays: 21,
  domainExpiryWarnDays: 30,
  httpTimeoutMs: 8000,
  tlsTimeoutMs: 6000,
  rdapTimeoutMs: 7000,
});

export function getWatchdogConfig(overrides = {}) {
  let properties = DEFAULT_WATCHDOG_PROPERTIES;

  if (Array.isArray(overrides.properties) && overrides.properties.length > 0) {
    properties = overrides.properties;
  } else if (process.env.WATCHDOG_PROPERTIES_JSON?.trim()) {
    try {
      const parsed = JSON.parse(process.env.WATCHDOG_PROPERTIES_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        properties = parsed;
      }
    } catch (err) {
      console.warn('Invalid WATCHDOG_PROPERTIES_JSON, using default properties:', err.message);
    }
  } else if (process.env.WATCHDOG_DOMAINS?.trim()) {
    const domains = process.env.WATCHDOG_DOMAINS.split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (domains.length > 0) {
      properties = domains.map((domain) => ({
        domain,
        name: domain,
        endpoints: [`https://${domain}/`],
      }));
    }
  }

  const normalizedProperties = properties.map((item) => {
    if (typeof item === 'string') {
      const domain = item.trim().toLowerCase();
      return {
        domain,
        name: domain,
        endpoints: [`https://${domain}/`],
      };
    }
    const domain = String(item.domain ?? '').trim().toLowerCase();
    const endpoints =
      Array.isArray(item.endpoints) && item.endpoints.length > 0
        ? item.endpoints
        : [`https://${domain}/`];
    return {
      domain,
      name: item.name ?? domain,
      endpoints,
    };
  });

  const thresholds = {
    slowLatencyMs:
      overrides.thresholds?.slowLatencyMs ??
      (Number.parseInt(process.env.WATCHDOG_SLOW_MS ?? '', 10) ||
        DEFAULT_WATCHDOG_THRESHOLDS.slowLatencyMs),
    tlsExpiryWarnDays:
      overrides.thresholds?.tlsExpiryWarnDays ??
      (Number.parseInt(process.env.WATCHDOG_CERT_WARN_DAYS ?? '', 10) ||
        DEFAULT_WATCHDOG_THRESHOLDS.tlsExpiryWarnDays),
    domainExpiryWarnDays:
      overrides.thresholds?.domainExpiryWarnDays ??
      (Number.parseInt(process.env.WATCHDOG_DOMAIN_WARN_DAYS ?? '', 10) ||
        DEFAULT_WATCHDOG_THRESHOLDS.domainExpiryWarnDays),
    httpTimeoutMs:
      overrides.thresholds?.httpTimeoutMs ?? DEFAULT_WATCHDOG_THRESHOLDS.httpTimeoutMs,
    tlsTimeoutMs:
      overrides.thresholds?.tlsTimeoutMs ?? DEFAULT_WATCHDOG_THRESHOLDS.tlsTimeoutMs,
    rdapTimeoutMs:
      overrides.thresholds?.rdapTimeoutMs ?? DEFAULT_WATCHDOG_THRESHOLDS.rdapTimeoutMs,
  };

  return {
    properties: normalizedProperties,
    thresholds,
  };
}

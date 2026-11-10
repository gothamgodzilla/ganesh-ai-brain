import axios, { AxiosError } from "axios";

export async function httpGet<T>(
  url: string,
  params?: Record<string, string | number | undefined>,
  headers?: Record<string, string>
): Promise<T> {
  const response = await axios.get<T>(url, {
    params,
    headers,
    timeout: 20000,
  });
  return response.data;
}

export async function httpPost<T>(
  url: string,
  data?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const response = await axios.post<T>(url, data, {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    timeout: 20000,
  });
  return response.data;
}

/**
 * Turns an Axios (or generic) error into an actionable message for the
 * calling agent. Never leaks header/auth values.
 */
export function handleApiError(error: unknown, serviceName: string): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<any>;
    if (err.response) {
      const status = err.response.status;
      const bodyMessage =
        (err.response.data && (err.response.data.error_message || err.response.data.message)) ||
        undefined;
      switch (status) {
        case 401:
        case 403:
          return `Error: ${serviceName} rejected the request (${status} — auth/permission). Check the corresponding API key/token env var is set and has the right scopes/services enabled.`;
        case 404:
          return `Error: ${serviceName} returned 404 — the resource/endpoint was not found. Double-check IDs and endpoint configuration.`;
        case 429:
          return `Error: ${serviceName} rate limit exceeded (429). Back off and retry, or reduce request volume/radius.`;
        default:
          return `Error: ${serviceName} request failed with status ${status}${
            bodyMessage ? ` — ${bodyMessage}` : ""
          }.`;
      }
    }
    if (err.code === "ECONNABORTED") {
      return `Error: ${serviceName} request timed out. Try again or narrow the request.`;
    }
    return `Error: ${serviceName} network error — ${err.message}.`;
  }
  return `Error: Unexpected error calling ${serviceName}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/**
 * The MCP SDK types `structuredContent` as `Record<string, unknown>`. Our
 * domain interfaces (ResolvedLocation, LeadRecord, etc.) are precise types
 * without an index signature, so TS rejects passing them directly — this
 * is a narrow, intentional cast at the tool-response boundary only.
 */
export function asStructured<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

// SSRF protection for CIMD metadata fetching
// Blocks requests to internal networks, localhost, and private IP ranges

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

const PRIVATE_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // Link-local
  /^fc00:/i, // IPv6 unique local
  /^fd00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

const BLOCKED_DOMAIN_PATTERNS = [
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /\.localdomain$/i,
  /\.corp$/i,
  /\.lan$/i,
];

/**
 * Check if a hostname matches private IP patterns
 */
function isPrivateIp(hostname: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a hostname matches blocked domain patterns
 */
function isBlockedDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const pattern of BLOCKED_DOMAIN_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

export type SsrfCheckResult = { safe: true } | { safe: false; reason: string };

/**
 * Validate a URL for SSRF safety before making outbound requests.
 *
 * Rules:
 * - Must be HTTPS (HTTP blocked)
 * - Must not target localhost or loopback
 * - Must not target private IP ranges
 * - Must not target internal domain patterns
 * - Must have non-root pathname (for CIMD URLs)
 */
export function checkSsrfSafe(
  urlString: string,
  options?: { requireNonRootPath?: boolean },
): SsrfCheckResult {
  const requireNonRootPath = options?.requireNonRootPath ?? true;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { safe: false, reason: 'invalid_url' };
  }

  // Must be HTTPS
  if (url.protocol !== 'https:') {
    return { safe: false, reason: 'https_required' };
  }

  const hostname = url.hostname.toLowerCase();

  // Block known dangerous hosts
  if (BLOCKED_HOSTS.has(hostname)) {
    return { safe: false, reason: 'blocked_host' };
  }

  // Block private IP ranges
  if (isPrivateIp(hostname)) {
    return { safe: false, reason: 'private_ip' };
  }

  // Block internal domain patterns
  if (isBlockedDomain(hostname)) {
    return { safe: false, reason: 'internal_domain' };
  }

  // CIMD URLs must have non-root pathname
  if (requireNonRootPath && (url.pathname === '/' || url.pathname === '')) {
    return { safe: false, reason: 'root_path_not_allowed' };
  }

  return { safe: true };
}

/**
 * Convenience function that returns boolean
 */
export function isSsrfSafe(
  urlString: string,
  options?: { requireNonRootPath?: boolean },
): boolean {
  return checkSsrfSafe(urlString, options).safe;
}

/**
 * Throws if URL is not SSRF-safe
 */
export function assertSsrfSafe(
  urlString: string,
  options?: { requireNonRootPath?: boolean },
): void {
  const result = checkSsrfSafe(urlString, options);
  if (result.safe === false) {
    throw new Error(`ssrf_blocked: ${result.reason}`);
  }
}

export function resolveRoomName(value: unknown, fallback = ''): string {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const namedValue = extractNameFromObjectLiteral(trimmed);
    if (namedValue) {
      return namedValue;
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const normalized = normalizeObjectString(trimmed);
      if (normalized) {
        try {
          const parsed = JSON.parse(normalized);
          const resolved = resolveRoomName(parsed, fallback);
          if (resolved) return resolved;
        } catch {
          // ignore parsing errors and fall through
        }
      }
    }
    return trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['label', 'name', 'room', 'title', 'id']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return fallback;
}

export function slugifyRoomName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeObjectString(value: string): string | null {
  try {
    // Replace single quotes with double quotes, but only when they behave as JSON quotes.
    const doubleQuoted = value
      .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*?)'/g, ':"$1"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');
    return doubleQuoted;
  } catch {
    return null;
  }
}

function extractNameFromObjectLiteral(value: string): string | null {
  const singleQuoteMatch = value.match(/'name'\s*:\s*'([^']+)'/);
  if (singleQuoteMatch) {
    return singleQuoteMatch[1].trim();
  }
  const doubleQuoteMatch = value.match(/"name"\s*:\s*"([^"]+)"/);
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1].trim();
  }
  return null;
}

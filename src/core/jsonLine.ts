function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return null;
}

export function findJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const value = parseObject(lines[i]);
    if (value) return value;
  }
  // `auth status` prints its object over several lines, from a line starting with { to one starting with }.
  for (let end = lines.length - 1; end >= 0; end--) {
    if (!lines[end].startsWith('}')) continue;
    for (let start = end - 1; start >= 0; start--) {
      if (!lines[start].startsWith('{')) continue;
      const value = parseObject(lines.slice(start, end + 1).join('\n'));
      if (value) return value;
    }
  }
  return null;
}

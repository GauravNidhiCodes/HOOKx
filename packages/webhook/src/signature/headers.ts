export function headerValue(
  headers: ReadonlyMap<string, string>,
  name: string,
): string | undefined {
  const value = headers.get(name.toLowerCase());
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function toRawBodyBytes(rawBody: string | Uint8Array): Uint8Array {
  if (typeof rawBody === "string") {
    return new TextEncoder().encode(rawBody);
  }
  return rawBody;
}

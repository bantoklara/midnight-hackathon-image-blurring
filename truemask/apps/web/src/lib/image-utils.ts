export async function sha256(value: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", value);

  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  return sha256(buffer);
}

export function shortHash(hash: string): string {
  if (!hash) return "";

  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

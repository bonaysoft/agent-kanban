function hashBytes(input: string): number[] {
  let h = 0x811c9dc5;
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  for (let i = 0; i < 20; i++) {
    h ^= i;
    h = Math.imul(h, 0x01000193);
    bytes.push((h >>> 0) & 0xff);
  }
  return bytes;
}

export function agentIdenticon(publicKey: string): boolean[][] {
  const bytes = hashBytes(publicKey);
  const grid: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    const r: boolean[] = [];
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      r.push(((bytes[2 + Math.floor(idx / 8)] >> (idx % 8)) & 1) === 1);
    }
    grid.push([r[0], r[1], r[2], r[1], r[0]]);
  }
  return grid;
}

export function agentColor(publicKey: string): string {
  const bytes = hashBytes(publicKey);
  const hue = 160 + (((bytes[0] << 8) | bytes[1]) % 61);
  const sat = 65 + (bytes[2] % 16);
  const light = 55 + (bytes[3] % 11);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export function agentFingerprint(publicKey: string): string {
  const bytes = hashBytes(publicKey);
  return bytes
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":");
}

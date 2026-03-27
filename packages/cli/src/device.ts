import { createHash } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";

export function generateDeviceId(): string {
  const host = hostname();
  const nets = networkInterfaces();
  let mac = "";
  for (const ifaces of Object.values(nets)) {
    const found = ifaces?.find((i) => !i.internal && i.mac !== "00:00:00:00:00:00");
    if (found) {
      mac = found.mac;
      break;
    }
  }
  return createHash("sha256").update(`${host}:${mac}`).digest("hex").slice(0, 16);
}

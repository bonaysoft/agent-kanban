// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UsageInfo } from "@agent-kanban/shared";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");

let db: D1Database;
let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql", "0002_rename_task_logs_to_task_notes.sql"];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  }
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  db = await mf.getD1Database("DB");
  await applyMigrations(db);
});

afterAll(async () => {
  await mf.dispose();
});

describe("machine usage tracking", () => {
  let machineId: string;

  it("createMachine stores os/version/runtimes and returns usage_info as null", async () => {
    const { createMachine } = await import("../apps/web/functions/api/machineRepo");
    const machine = await createMachine(db, "user-001", {
      name: "test-machine",
      os: "darwin arm64",
      version: "1.0.0",
      runtimes: ["Claude Code"],
    });
    machineId = machine.id;
    expect(machine.os).toBe("darwin arm64");
    expect(machine.version).toBe("1.0.0");
    expect(machine.runtimes).toEqual(["Claude Code"]);
    expect(machine.usage_info).toBeNull();
  });

  it("heartbeat without usage_info keeps it null", async () => {
    const { updateMachine: heartbeat } = await import("../apps/web/functions/api/machineRepo");
    const machine = await heartbeat(db, machineId, "user-001", {});
    expect(machine.usage_info).toBeNull();
    expect(machine.status).toBe("online");
  });

  it("heartbeat with usage_info stores and returns parsed object", async () => {
    const { updateMachine: heartbeat } = await import("../apps/web/functions/api/machineRepo");
    const usageInfo: UsageInfo = {
      five_hour: { utilization: 23.5, resets_at: "2026-03-21T15:00:00Z" },
      seven_day: { utilization: 8.2, resets_at: "2026-03-25T00:00:00Z" },
      updated_at: "2026-03-21T10:00:00Z",
    };
    const machine = await heartbeat(db, machineId, "user-001", { usage_info: usageInfo });

    expect(typeof machine.usage_info).toBe("object");
    expect(machine.usage_info!.five_hour!.utilization).toBe(23.5);
    expect(machine.usage_info!.seven_day!.resets_at).toBe("2026-03-25T00:00:00Z");
    expect(machine.usage_info!.updated_at).toBe("2026-03-21T10:00:00Z");
  });

  it("getMachine returns parsed usage_info and runtimes", async () => {
    const { getMachine } = await import("../apps/web/functions/api/machineRepo");
    const machine = await getMachine(db, machineId, "user-001");

    expect(machine).toBeTruthy();
    expect(machine!.runtimes).toEqual(["Claude Code"]);
    expect(typeof machine!.usage_info).toBe("object");
    expect(machine!.usage_info!.five_hour!.utilization).toBe(23.5);
  });

  it("listMachines returns parsed usage_info", async () => {
    const { listMachines } = await import("../apps/web/functions/api/machineRepo");
    const machines = await listMachines(db, "user-001");

    expect(machines.length).toBeGreaterThan(0);
    const m = machines.find((m) => m.id === machineId)!;
    expect(typeof m.usage_info).toBe("object");
    expect(m.usage_info!.five_hour!.utilization).toBe(23.5);
  });

  it("heartbeat overwrites usage_info with new data", async () => {
    const { updateMachine: heartbeat } = await import("../apps/web/functions/api/machineRepo");
    const newUsage: UsageInfo = {
      five_hour: { utilization: 75.0, resets_at: "2026-03-21T20:00:00Z" },
      seven_day_opus: { utilization: 45.0, resets_at: "2026-03-28T00:00:00Z" },
      updated_at: "2026-03-21T15:00:00Z",
    };
    const machine = await heartbeat(db, machineId, "user-001", { usage_info: newUsage });

    expect(machine.usage_info!.five_hour!.utilization).toBe(75.0);
    expect(machine.usage_info!.seven_day_opus!.utilization).toBe(45.0);
    expect(machine.usage_info!.seven_day).toBeUndefined();
  });

  it("heartbeat updates version and runtimes", async () => {
    const { updateMachine: heartbeat } = await import("../apps/web/functions/api/machineRepo");
    const machine = await heartbeat(db, machineId, "user-001", {
      version: "2.0.0",
      runtimes: ["Claude Code", "Codex"],
    });

    expect(machine.version).toBe("2.0.0");
    expect(machine.runtimes).toEqual(["Claude Code", "Codex"]);
  });

  it("heartbeat updating only version preserves runtimes", async () => {
    const { updateMachine: heartbeat } = await import("../apps/web/functions/api/machineRepo");
    const machine = await heartbeat(db, machineId, "user-001", { version: "2.1.0" });

    expect(machine.version).toBe("2.1.0");
    expect(machine.runtimes).toEqual(["Claude Code", "Codex"]);
  });

  it("runtimes are parsed as JSON array from DB reads", async () => {
    const { getMachine, listMachines } = await import("../apps/web/functions/api/machineRepo");

    const single = await getMachine(db, machineId, "user-001");
    expect(Array.isArray(single!.runtimes)).toBe(true);
    expect(single!.runtimes).toEqual(["Claude Code", "Codex"]);

    const list = await listMachines(db, "user-001");
    const m = list.find((m) => m.id === machineId)!;
    expect(Array.isArray(m.runtimes)).toBe(true);
  });
});

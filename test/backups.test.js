import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { BackupService } from "../src/services/backups.js";

async function withTempDir(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-bus-backup-"));

  try {
    await testFn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("backup service", () => {
  it("creates and restores JSON data backups", async () => {
    await withTempDir(async (dataDir) => {
      await fs.writeFile(path.join(dataDir, "team-bus.json"), JSON.stringify([{ id: "before" }]));
      await fs.writeFile(path.join(dataDir, "exchange-rates.json"), JSON.stringify({ USD: 7 }));
      const service = new BackupService(dataDir, { keep: 10 });

      const backup = await service.createBackup({
        now: new Date("2026-07-10T08:30:00.000Z"),
      });
      await fs.writeFile(path.join(dataDir, "team-bus.json"), JSON.stringify([{ id: "after" }]));
      const restore = await service.restoreBackup(backup.id);

      assert.match(backup.id, /^team-bus-backup-20260710-083000-[a-f0-9]{8}\.json$/);
      assert.equal(backup.fileCount, 2);
      assert.equal(restore.fileCount, 2);
      assert.deepEqual(
        JSON.parse(await fs.readFile(path.join(dataDir, "team-bus.json"), "utf8")),
        [{ id: "before" }]
      );
      assert.deepEqual(
        JSON.parse(await fs.readFile(path.join(dataDir, "exchange-rates.json"), "utf8")),
        { USD: 7 }
      );
      assert.equal((await service.listBackups()).length, 1);
    });
  });

  it("creates at most one automatic backup per day", async () => {
    await withTempDir(async (dataDir) => {
      await fs.writeFile(path.join(dataDir, "team-bus.json"), "[]\n");
      const service = new BackupService(dataDir, { keep: 10 });
      const first = await service.ensureDailyBackup("2026-07-10");
      const second = await service.ensureDailyBackup("2026-07-10");

      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal((await service.listBackups()).length, 1);
    });
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import * as jsonStoreModule from "../src/store/jsonStore.js";

const { JsonStore } = jsonStoreModule;

async function withTempDir(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-bus-json-store-"));

  try {
    await testFn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function waitForFile(filePath) {
  while (true) {
    try {
      return await fs.stat(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

test("creates a missing store from its seed", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "nested", "records.json");
    const seed = [{ id: "seed" }];
    const store = new JsonStore(filePath, seed);

    assert.deepEqual(await store.list(), seed);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), seed);
  });
});

test("persists replacements across store instances", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const store = new JsonStore(filePath);
    const records = [{ id: "persisted" }];

    await store.replace(records);

    assert.deepEqual(await new JsonStore(filePath).list(), records);
  });
});

test("does not create temp files when listing an existing store", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const store = new JsonStore(filePath, [{ id: "seed" }]);
    await store.list();
    const filesBefore = await fs.readdir(tempDir);
    const directoryBefore = await fs.stat(tempDir, { bigint: true });

    await store.list();
    await store.list();

    const filesAfter = await fs.readdir(tempDir);
    const directoryAfter = await fs.stat(tempDir, { bigint: true });
    assert.deepEqual(filesAfter, filesBefore);
    assert.equal(directoryAfter.mtimeNs, directoryBefore.mtimeNs);
  });
});

test("creates a new initialized store with mode 0600", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");

    await new JsonStore(filePath).list();

    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });
});

test("replaces store contents with mode 0600", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    await fs.writeFile(filePath, "[]\n", { mode: 0o600 });

    await new JsonStore(filePath).replace([{ id: "replacement" }]);

    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });
});

test("publishes a complete seed before concurrent store instances can read it", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const payload = "x".repeat(16 * 1024 * 1024);
    const seed = [{ id: "seed", payload }];
    const expectedSize = Buffer.byteLength(`${JSON.stringify(seed, null, 2)}\n`);
    const writer = new JsonStore(filePath, seed).list();
    const firstVisibleStat = await waitForFile(filePath);
    const readers = Array.from({ length: 8 }, () =>
      new JsonStore(filePath, []).list()
    );
    const results = await Promise.allSettled([writer, ...readers]);
    const failures = results.filter((result) => result.status === "rejected");

    assert.equal(firstVisibleStat.size, expectedSize);
    assert.equal(
      failures.length,
      0,
      failures.map((result) => result.reason?.message).join("\n")
    );
    for (const result of results) {
      assert.equal(result.value[0].payload.length, payload.length);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), seed);
  });
});

test("removes initialization temp files after concurrent creation attempts", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const stores = Array.from(
      { length: 24 },
      () => new JsonStore(filePath, [{ id: "seed" }])
    );

    await Promise.all(stores.map((store) => store.list()));

    assert.deepEqual(await fs.readdir(tempDir), ["records.json"]);
  });
});

test("serializes concurrent updates without losing records", async () => {
  await withTempDir(async (tempDir) => {
    const store = new JsonStore(path.join(tempDir, "records.json"));

    await Promise.all(
      Array.from({ length: 12 }, (_, id) =>
        store.update(async (records) => {
          await new Promise((resolve) => setTimeout(resolve, id % 3));
          return [...records, { id }];
        })
      )
    );

    assert.deepEqual(
      (await store.list()).map((record) => record.id),
      Array.from({ length: 12 }, (_, id) => id)
    );
  });
});

test("continues queued updates after a mutator rejects", async () => {
  await withTempDir(async (tempDir) => {
    const store = new JsonStore(path.join(tempDir, "records.json"));
    const failedUpdate = store.update(() => {
      throw new Error("expected mutator failure");
    });
    const successfulUpdate = store.update((records) => [
      ...records,
      { id: "after-failure" },
    ]);

    await assert.rejects(failedUpdate, /expected mutator failure/);
    await successfulUpdate;

    assert.deepEqual(await store.list(), [{ id: "after-failure" }]);
  });
});

test("uses unique temp files for overlapping atomic replacements", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const store = new JsonStore(filePath);

    await Promise.all([
      store.replace([{ id: "first" }]),
      store.replace([{ id: "second" }]),
      store.replace([{ id: "third" }]),
    ]);

    const records = await store.list();
    assert.equal(records.length, 1);
    assert.ok(["first", "second", "third"].includes(records[0].id));
    assert.equal((await fs.readdir(tempDir)).some((name) => name.endsWith(".tmp")), false);
  });
});

test("cleans up a temporary file when an atomic replacement fails", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    await fs.mkdir(filePath);
    const store = new JsonStore(filePath);

    await assert.rejects(store.replace([{ id: "blocked" }]));
    assert.equal((await fs.readdir(tempDir)).some((name) => name.endsWith(".tmp")), false);
  });
});

test("reports invalid JSON as corruption without overwriting the source", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const source = "[{\"id\":\"broken\"}";
    await fs.writeFile(filePath, source, "utf8");

    await assert.rejects(new JsonStore(filePath).list(), (error) => {
      assert.equal(error.constructor, jsonStoreModule.JsonStoreCorruptionError);
      assert.equal(error.filePath, filePath);
      return true;
    });
    assert.equal(await fs.readFile(filePath, "utf8"), source);
  });
});

test("reports a non-array JSON root as corruption without overwriting the source", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const source = "{\"id\":\"not-an-array\"}\n";
    await fs.writeFile(filePath, source, "utf8");

    await assert.rejects(new JsonStore(filePath).list(), (error) => {
      assert.equal(error.constructor, jsonStoreModule.JsonStoreCorruptionError);
      assert.equal(error.filePath, filePath);
      return true;
    });
    assert.equal(await fs.readFile(filePath, "utf8"), source);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import * as jsonStoreModule from "../src/store/jsonStore.js";

const { JsonStore } = jsonStoreModule;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withTempDir(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-bus-json-store-"));

  try {
    await testFn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
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

test("does not let late initialization overwrite another instance's committed update", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "records.json");
    const seed = [{ id: "seed" }];
    const seedReplacementStarted = deferred();
    const releaseSeedReplacement = deferred();

    class DelayedSeedStore extends JsonStore {
      async replace(records) {
        if (records === this.seed) {
          seedReplacementStarted.resolve();
          await releaseSeedReplacement.promise;
        }
        return await super.replace(records);
      }
    }

    const delayedStore = new DelayedSeedStore(filePath, seed);
    const delayedList = delayedStore.list();
    await Promise.race([seedReplacementStarted.promise, delayedList]);

    const writerStore = new JsonStore(filePath, seed);
    await writerStore.update((records) => [...records, { id: "committed" }]);

    releaseSeedReplacement.resolve();
    await delayedList;

    assert.deepEqual(await new JsonStore(filePath).list(), [
      { id: "seed" },
      { id: "committed" },
    ]);
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

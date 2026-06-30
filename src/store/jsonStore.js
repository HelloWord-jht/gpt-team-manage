import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class JsonStoreCorruptionError extends Error {
  constructor(filePath, reason, options = {}) {
    super(`JSON store is corrupt: ${reason}`, options);
    this.name = "JsonStoreCorruptionError";
    this.filePath = filePath;
  }
}

// Abrupt termination can leave orphaned temp files; startup cleanup is out of scope.
async function cleanupTempFile(tmpPath, primaryError) {
  try {
    await fs.rm(tmpPath, { force: true });
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError;
    primaryError.cleanupError = cleanupError;
  }
}

export class JsonStore {
  constructor(filePath, seed = []) {
    this.filePath = filePath;
    this.seed = seed;
    // Updates serialize per instance; initialization is exclusive across instances.
    // Cross-process read-modify-write locking is outside this app's single-process runtime.
    this.updateQueue = Promise.resolve();
    this.initializationPromise = null;
  }

  async list() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");
    let records;

    try {
      records = JSON.parse(raw);
    } catch (cause) {
      throw new JsonStoreCorruptionError(this.filePath, "invalid JSON", { cause });
    }

    if (!Array.isArray(records)) {
      throw new JsonStoreCorruptionError(this.filePath, "root value must be an array");
    }

    return records;
  }

  async replace(records) {
    if (!Array.isArray(records)) {
      throw new TypeError("JsonStore records must be an array");
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`
    );
    let primaryError = null;

    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      primaryError = error;
    } finally {
      await cleanupTempFile(tmpPath, primaryError);
    }

    if (primaryError) throw primaryError;
  }

  update(mutator) {
    if (typeof mutator !== "function") {
      return Promise.reject(new TypeError("JsonStore update requires a mutator function"));
    }

    const operation = this.updateQueue.then(async () => {
      const records = await this.list();
      const result = await mutator(records);
      const nextRecords = result === undefined ? records : result;
      await this.replace(nextRecords);
      return nextRecords;
    });

    this.updateQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async ensureFile() {
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }

    const initialization = this.initializeFile();
    this.initializationPromise = initialization;

    try {
      await initialization;
    } finally {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
    }
  }

  async initializeFile() {
    try {
      await fs.access(this.filePath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (!Array.isArray(this.seed)) {
      throw new TypeError("JsonStore records must be an array");
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.init.tmp`
    );
    let primaryError = null;

    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(this.seed, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      try {
        await fs.link(tmpPath, this.filePath);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } catch (error) {
      primaryError = error;
    } finally {
      await cleanupTempFile(tmpPath, primaryError);
    }

    if (primaryError) throw primaryError;
  }
}

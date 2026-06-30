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

export class JsonStore {
  constructor(filePath, seed = []) {
    this.filePath = filePath;
    this.seed = seed;
    this.updateQueue = Promise.resolve();
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

    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    }
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
    try {
      await fs.access(this.filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.replace(this.seed);
    }
  }
}

import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(filePath, seed = []) {
    this.filePath = filePath;
    this.seed = seed;
  }

  async list() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async replace(records) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, this.filePath);
  }

  async ensureFile() {
    try {
      await fs.access(this.filePath);
    } catch {
      await this.replace(this.seed);
    }
  }
}

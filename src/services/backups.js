import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class BackupService {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.backupDir = options.backupDir || path.join(dataDir, "backups");
    this.keep = Number.isFinite(Number(options.keep)) ? Number(options.keep) : 30;
  }

  async listBackups() {
    await fs.mkdir(this.backupDir, { recursive: true });
    const names = await fs.readdir(this.backupDir);
    const backups = await Promise.all(
      names
        .filter((name) => isBackupName(name))
        .map(async (name) => {
          const filePath = path.join(this.backupDir, name);
          const stat = await fs.stat(filePath);
          let createdAt = stat.mtime.toISOString();
          let fileCount = 0;

          try {
            const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
            createdAt = payload.createdAt || createdAt;
            fileCount = Object.keys(payload.files || {}).length;
          } catch {
            fileCount = 0;
          }

          return { id: name, createdAt, size: stat.size, fileCount };
        })
    );

    return backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async createBackup(options = {}) {
    const now = options.now || new Date();
    const createdAt = now.toISOString();
    const id = `team-bus-backup-${formatBackupTimestamp(now)}-${randomUUID().slice(0, 8)}.json`;
    const files = await this.readDataFiles();
    const payload = {
      id,
      createdAt,
      version: 1,
      files,
    };
    const filePath = path.join(this.backupDir, id);

    await fs.mkdir(this.backupDir, { recursive: true });
    await writeJsonAtomic(filePath, payload);
    await this.pruneBackups();

    const stat = await fs.stat(filePath);
    return { id, createdAt, size: stat.size, fileCount: Object.keys(files).length };
  }

  async restoreBackup(id) {
    const name = safeBackupName(id);
    const filePath = path.join(this.backupDir, name);
    const payload = JSON.parse(await fs.readFile(filePath, "utf8"));

    if (!payload || typeof payload !== "object" || !payload.files || typeof payload.files !== "object") {
      throw requestError(400, "备份文件格式不正确");
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    for (const [fileName, value] of Object.entries(payload.files)) {
      if (!isDataJsonFile(fileName)) continue;
      await writeJsonAtomic(path.join(this.dataDir, fileName), value);
    }

    return {
      id: name,
      restoredAt: new Date().toISOString(),
      fileCount: Object.keys(payload.files).filter(isDataJsonFile).length,
    };
  }

  async ensureDailyBackup(today) {
    const dateText = String(today || new Date().toISOString().slice(0, 10));
    const dateKey = dateText.replace(/-/g, "");
    const backups = await this.listBackups();
    if (backups.some((backup) => backup.id.includes(dateKey))) {
      return { created: false, backup: backups.find((backup) => backup.id.includes(dateKey)) };
    }

    return { created: true, backup: await this.createBackup({ now: new Date(`${dateText}T00:00:00.000Z`) }) };
  }

  async readDataFiles() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
    const files = {};

    for (const entry of entries) {
      if (!entry.isFile() || !isDataJsonFile(entry.name)) continue;
      try {
        files[entry.name] = JSON.parse(await fs.readFile(path.join(this.dataDir, entry.name), "utf8"));
      } catch {
        files[entry.name] = null;
      }
    }

    return files;
  }

  async pruneBackups() {
    const backups = await this.listBackups();
    const stale = backups.slice(this.keep);
    await Promise.all(stale.map((backup) => fs.rm(path.join(this.backupDir, backup.id), { force: true })));
  }
}

export function startBackupScheduler({ backupService, logger = console, now = () => new Date() }) {
  if (!backupService?.ensureDailyBackup) return null;

  const run = async () => {
    try {
      const today = todayInChina(now());
      const result = await backupService.ensureDailyBackup(today);
      if (result.created) logger.log?.(`Daily data backup created: ${result.backup.id}`);
    } catch (error) {
      logger.error?.("Daily data backup failed", error);
    }
  };

  void run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

function isBackupName(name) {
  return /^team-bus-backup-\d{8}-\d{6}-[a-f0-9]{8}\.json$/.test(String(name));
}

function safeBackupName(id) {
  const name = path.basename(String(id || ""));
  if (!isBackupName(name)) throw requestError(400, "备份文件名不正确");
  return name;
}

function isDataJsonFile(name) {
  return /^[a-z0-9-]+\.json$/i.test(String(name || "")) && !String(name).includes("backup");
}

function formatBackupTimestamp(date) {
  const [day, time] = date.toISOString().slice(0, 19).split("T");
  return `${day.replace(/-/g, "")}-${time.replace(/:/g, "")}`;
}

async function writeJsonAtomic(filePath, value) {
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
}

function todayInChina(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

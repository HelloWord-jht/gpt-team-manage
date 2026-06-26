import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./http/app.js";
import { JsonStore } from "./store/jsonStore.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.DATA_PATH || path.join(rootDir, "data", "team-bus.json");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 5176);
const host = process.env.HOST || "127.0.0.1";

const store = new JsonStore(dataPath);
const server = createServer(createApp({ store, publicDir }));

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Team Bus Manager is running at http://${displayHost}:${port}`);
});

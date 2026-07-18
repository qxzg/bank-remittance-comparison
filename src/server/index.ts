import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp({
  feesPath: path.join(projectRoot, "data", "fees.json"),
  distPath: path.join(projectRoot, "dist"),
});

app.listen(port, host, () => {
  console.log(`Bank comparison server: http://${host}:${port}`);
});


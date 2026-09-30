import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED = [
  "src/3d/modern/v15/types.ts",
  "src/3d/modern/v15/capabilityProbe.ts",
  "src/3d/modern/v15/adaptiveQuality.ts",
  "src/3d/modern/v15/frameScheduler.ts",
  "src/3d/modern/v15/inputPipeline.ts",
  "src/3d/modern/v15/assetPipeline.ts",
  "src/3d/modern/v15/worldPartition.ts",
  "src/3d/modern/v15/networkEnvelope.ts",
  "src/3d/modern/v15/saveStore.ts",
  "src/3d/modern/v15/renderBackend.ts",
  "src/3d/modern/v15/renderTelemetry.ts",
  "src/3d/modern/v15/runtimeSupervisor.ts",
  "src/3d/modern/v15/platformBridge.ts",
  "src/3d/modern/v15/index.ts",
];

const failures = [];
const notes = [];

for (const relative of REQUIRED) {
  try {
    await access(resolve(ROOT, relative));
  } catch {
    failures.push("missing:" + relative);
  }
}

async function source(relative) {
  try { return await readFile(resolve(ROOT, relative), "utf8"); }
  catch { return ""; }
}

const types = await source("src/3d/modern/v15/types.ts");
if (!types.includes("Brand<T") || !types.includes("checksumV15")) failures.push("types: branded/checksum contract missing");

const quality = await source("src/3d/modern/v15/adaptiveQuality.ts");
if (!quality.includes("overBudgetStreak") || !quality.includes("underBudgetStreak")) failures.push("quality: hysteresis contract missing");

const scheduler = await source("src/3d/modern/v15/frameScheduler.ts");
if (!scheduler.includes("maxCatchUpTicks") || !scheduler.includes("droppedSeconds")) failures.push("scheduler: spiral guard missing");

const input = await source("src/3d/modern/v15/inputPipeline.ts");
if (!input.includes("ingestGamepad") || !input.includes("ingestTouchMove")) failures.push("input: semantic multi-device surface missing");

const assets = await source("src/3d/modern/v15/assetPipeline.ts");
if (!assets.includes("DIGEST_MISMATCH") || !assets.includes("maxConcurrent")) failures.push("asset: integrity/concurrency boundary missing");

const network = await source("src/3d/modern/v15/networkEnvelope.ts");
if (!network.includes("checksumV15") || !network.includes("maxBytesPerSecond")) failures.push("network: checksum/rate boundary missing");

const save = await source("src/3d/modern/v15/saveStore.ts");
if (!save.includes("AAPW-SAVE-V15") || !save.includes("save checksum mismatch")) failures.push("save: version/checksum boundary missing");

const bridge = await source("src/3d/modern/v15/platformBridge.ts");
if (!bridge.includes("tickModernRuntime") || !bridge.includes("RuntimeSupervisorV15")) failures.push("bridge: live runtime integration missing");

const status = failures.length === 0 ? "pass" : "fail";
console.log(JSON.stringify({ version: 15, required: REQUIRED.length, failures, notes, status }, null, 2));
if (status !== "pass") process.exitCode = 1;

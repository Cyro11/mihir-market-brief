import fs from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./config.js";
import { ensureDir } from "./utils.js";

const distDir = path.join(rootDir, "dist");
const entries = ["index.html", "moves.html", "macro.html", "markets.html", "deals.html", "private-markets.html", "deep-dive.html", "themes.html", "sources.html", "archive.html", "notes.html", "issues", "data", "assets"];

async function copyEntry(entry) {
  const from = path.join(rootDir, entry);
  const to = path.join(distDir, entry);
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.cp(from, to, { recursive: true });
  } else {
    await ensureDir(path.dirname(to));
    await fs.copyFile(from, to);
  }
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);
  for (const entry of entries) await copyEntry(entry);
  console.log(`Static site built at ${distDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

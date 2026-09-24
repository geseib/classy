import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReferenceFile, ResultsFile, SampleFile, SpeedFile } from "./types";

/**
 * Read the filed answers at build time. `RESULTS_FILE` lets you preview the
 * simulated output (`data/results.mock.json`) without touching the real file.
 * Only files inside data/ can be selected.
 */
export function loadData(): {
  sample: SampleFile;
  results: ResultsFile | null;
  speed: SpeedFile | null;
  reference: ReferenceFile | null;
} {
  const sample = JSON.parse(readFileSync(path.join(process.cwd(), "data", "sample.json"), "utf8")) as SampleFile;
  const file = path.join(process.cwd(), "data", path.basename(process.env.RESULTS_FILE ?? "results.json"));
  const results = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ResultsFile) : null;
  const speedFile = path.join(process.cwd(), "data", "speed.json");
  const speed = existsSync(speedFile) ? (JSON.parse(readFileSync(speedFile, "utf8")) as SpeedFile) : null;
  const refFile = path.join(process.cwd(), "data", "reference.json");
  const reference = existsSync(refFile) ? (JSON.parse(readFileSync(refFile, "utf8")) as ReferenceFile) : null;
  return { sample, results, speed, reference };
}

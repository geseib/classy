import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatasetKey } from "./datasets";
import type { ReferenceFile, ResultsFile, SampleFile, SpeedFile } from "./types";

type Loaded = {
  sample: SampleFile;
  results: ResultsFile | null;
  speed: SpeedFile | null;
  reference: ReferenceFile | null;
};

const readJson = <T,>(raw: string) => JSON.parse(raw) as T;

/**
 * Read one dataset's filed answers at build time. `RESULTS_FILE` lets you
 * preview the simulated output (`results.mock.json`) without touching the real
 * file. Only files inside the dataset's own data directory can be selected.
 * The speed test and reference models are optional, per dataset.
 *
 * Each branch spells its paths out inline, next to the fs call, because that is
 * the only form the build can trace; a path built elsewhere makes Next trace the
 * whole project. Keep the directories in step with `dir` in lib/datasets.ts.
 */
export function loadData(key: DatasetKey): Loaded {
  const name = path.basename(process.env.RESULTS_FILE ?? "results.json");
  if (key === "github") {
    const sample = readJson<SampleFile>(readFileSync(path.join(process.cwd(), "data", "github", "sample.json"), "utf8"));
    const file = path.join(process.cwd(), "data", "github", name);
    const results = existsSync(file) ? readJson<ResultsFile>(readFileSync(file, "utf8")) : null;
    const speedFile = path.join(process.cwd(), "data", "github", "speed.json");
    const speed = existsSync(speedFile) ? readJson<SpeedFile>(readFileSync(speedFile, "utf8")) : null;
    const refFile = path.join(process.cwd(), "data", "github", "reference.json");
    const reference = existsSync(refFile) ? readJson<ReferenceFile>(readFileSync(refFile, "utf8")) : null;
    return { sample, results, speed, reference };
  }
  const sample = readJson<SampleFile>(readFileSync(path.join(process.cwd(), "data", "sample.json"), "utf8"));
  const file = path.join(process.cwd(), "data", name);
  const results = existsSync(file) ? readJson<ResultsFile>(readFileSync(file, "utf8")) : null;
  const speedFile = path.join(process.cwd(), "data", "speed.json");
  const speed = existsSync(speedFile) ? readJson<SpeedFile>(readFileSync(speedFile, "utf8")) : null;
  const refFile = path.join(process.cwd(), "data", "reference.json");
  const reference = existsSync(refFile) ? readJson<ReferenceFile>(readFileSync(refFile, "utf8")) : null;
  return { sample, results, speed, reference };
}

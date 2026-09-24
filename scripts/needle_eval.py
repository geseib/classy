"""Run Needle 3 (cactus-needle) on the benchmark sample, locally, and file it as a reference model.

    pip install cactus-needle
    python3 scripts/needle_eval.py --limit 20     # smoke test: prints accuracy, files nothing
    python3 scripts/needle_eval.py                # all 1,000 reviews -> data/reference.json

Needle is a tool-calling / extraction model, so the task is posed as one tool whose only
argument is an enum, `sentiment: "positive" | "negative"`, with the same instructions and
label definitions the benchmark models get. Its decode grammar guarantees the answer is one
of the two labels. The label is never part of the input.

Each review is a fresh, stateless request, timed on this machine; the model runs on-device,
so there is no per-token cost. Resumable: answers are checkpointed to
data/.checkpoints/needle.jsonl, so an interrupted run picks up where it stopped. Telemetry
(anonymous usage counts) is switched off before the package is imported.
"""

import argparse
import json
import os
import platform
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("NEEDLE_TELEMETRY", "0")
os.environ.setdefault("DO_NOT_TRACK", "1")

import needle  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHECKPOINT = ROOT / "data" / ".checkpoints" / "needle.jsonl"
MODEL_ID = "cactus-compute/needle3"

# Same wording as INSTRUCTIONS and CRITERIA in scripts/run-eval.ts.
INSTRUCTIONS = "Classify the overall sentiment the author expresses toward the film in this IMDB movie review."
CRITERIA = {
    "positive": "The reviewer's overall opinion of the movie is favorable.",
    "negative": "The reviewer's overall opinion of the movie is unfavorable.",
}
SYSTEM = " ".join(["You are a sentiment classifier.", INSTRUCTIONS] + [f"{k}: {v}" for k, v in CRITERIA.items()])
TOOL = {
    "name": "record_sentiment",
    "description": "Record the overall sentiment the author expresses toward the film.",
    "parameters": {
        "type": "object",
        "properties": {
            "sentiment": {
                "type": "string",
                "enum": ["positive", "negative"],
                "description": f"positive: {CRITERIA['positive']} negative: {CRITERIA['negative']}",
            }
        },
        "required": ["sentiment"],
    },
}


def ensure_engine():
    """cactus-needle 3.0.5 asks Hugging Face for a 3.0.2 engine wheel that was never uploaded
    (404). Fall back to the newest published engine, 3.0.1, through the package's own
    NEEDLE3_LIB_PATH override."""
    if os.environ.get("NEEDLE3_LIB_PATH"):
        return
    from needle import _library_path
    from needle.agent import fetch

    try:
        _library_path(3)
    except Exception as err:
        if "404" not in str(err) and "Entry Not Found" not in str(err):
            raise
        dest = Path.home() / ".cache" / "cactus-needle" / "engine-3.0.1"
        dest.mkdir(parents=True, exist_ok=True)
        cached = dest / fetch._lib_name()
        path = str(cached) if cached.exists() else fetch.fetch_library("3.0.1", str(dest), generation=3)
        os.environ["NEEDLE3_LIB_PATH"] = path
        print(f"engine {fetch.engine_version(3)} is not published; using 3.0.1 ({path})")


def classify(agent, text):
    start = time.perf_counter()
    response = agent.complete("<review>\n" + text + "\n</review>", max_new_tokens=32)
    latency_ms = round((time.perf_counter() - start) * 1000)
    calls = response.get("function_calls") or []
    answer = (calls[0].get("arguments") or {}).get("sentiment") if calls else None
    return {
        "prediction": answer if answer in ("positive", "negative") else None,
        "raw": json.dumps(calls)[:200],
        "latencyMs": latency_ms,
        "confidence": response.get("confidence"),
    }


def load_checkpoint():
    done = {}
    if CHECKPOINT.exists():
        for line in CHECKPOINT.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                if row.get("prediction"):
                    done[row["id"]] = row
    return done


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="smoke test on the first N reviews; files nothing")
    args = parser.parse_args()

    items = json.loads((ROOT / "data" / "sample.json").read_text())["items"]
    if args.limit:
        items = items[: args.limit]

    ensure_engine()
    load_start = time.perf_counter()
    agent = needle.Needle(tools=[TOOL], system=SYSTEM, stateless=True, auto_date=False)
    print(f"model loaded in {time.perf_counter() - load_start:.1f}s")

    done = {} if args.limit else load_checkpoint()
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    todo = [i for i in items if i["id"] not in done]
    print(f"{len(items)} reviews, {len(todo)} to classify")
    with CHECKPOINT.open("a") as ckpt:
        for n, item in enumerate(todo, 1):
            try:
                row = {"id": item["id"], **classify(agent, item["text"])}
            except Exception as err:  # keep going; a rerun retries it
                row = {"id": item["id"], "prediction": None, "latencyMs": 0, "error": str(err)[:300]}
            done[item["id"]] = row
            if not args.limit:
                ckpt.write(json.dumps(row) + "\n")
                ckpt.flush()
            if n % 25 == 0 or n == len(todo):
                right = sum(done[i["id"]].get("prediction") == i["label"] for i in items if i["id"] in done)
                print(f"  {n}/{len(todo)} · {right}/{len(done)} correct so far", flush=True)

    rows = [(i, done.get(i["id"], {})) for i in items]
    right = sum(r.get("prediction") == i["label"] for i, r in rows)
    missing = [i["id"] for i, r in rows if not r.get("prediction")]
    lat = sorted(r["latencyMs"] for _, r in rows if r.get("prediction"))
    print(f"\n{MODEL_ID}: {right}/{len(items)} correct ({100 * right / len(items):.1f}%)")
    if lat:
        print(f"median {statistics.median(lat):.0f} ms · p95 {lat[int(0.95 * (len(lat) - 1))]} ms")
    if missing:
        print(f"{len(missing)} answers missing; rerun to retry them.", file=sys.stderr)
        sys.exit(1)
    if args.limit:
        print("--limit run: summary only.")
        return

    machine = f"{platform.system()} {platform.machine()}, {os.cpu_count()} CPUs, Python {platform.python_version()}"
    run = {
        "runAt": datetime.now(timezone.utc).isoformat(),
        "model": {
            "key": "needle",
            "id": MODEL_ID,
            "name": "Needle 3",
            "vendor": "Cactus Compute",
            "kind": "generative",
            "call": "needle.Needle(tools=[record_sentiment], stateless=True).complete(review)",
        },
        "rows": [
            {
                "id": i["id"],
                "label": i["label"],
                "answer": {"id": i["id"], "prediction": r["prediction"], "raw": r.get("raw"), "latencyMs": r["latencyMs"]},
            }
            for i, r in rows
        ],
        "throttledDiscarded": 0,
        "via": "local",
        "note": f"Needle 3 ran on-device{' with the 3.0.1 engine' if 'engine-3.0.1' in os.environ.get('NEEDLE3_LIB_PATH', '') else ''}, timed one request at a time on {machine}.",
    }
    ref_path = ROOT / "data" / "reference.json"
    refs = json.loads(ref_path.read_text())["references"] if ref_path.exists() else []
    refs = [r for r in refs if r["model"]["id"] != MODEL_ID] + [run]
    ref_path.write_text(json.dumps({"references": refs}, indent=1, ensure_ascii=False) + "\n")
    print(f"Filed -> {ref_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

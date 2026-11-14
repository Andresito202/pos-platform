import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { availableParallelism, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { argon2id, hash, verify, type HashOptions } from "argon2";

// Candidate measurements, not the production password policy. No verifier,
// password or salt is emitted. Run on each deployment target before selection.
const profiles = [
  { name: "owasp-19m-t2-p1", memoryCost: 19456, timeCost: 2, parallelism: 1 },
  { name: "candidate-64m-t3-p1", memoryCost: 65536, timeCost: 3, parallelism: 1 },
  { name: "candidate-64m-t3-p4", memoryCost: 65536, timeCost: 3, parallelism: 4 },
];
const samples = 12;
const batchSize = 4;
const batchSamples = 3;
const password = randomBytes(32);
const results = [];
const measure = async (action: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await action();
  return performance.now() - start;
};
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1),
  };
}
for (const profile of profiles) {
  const { name, ...parameters } = profile;
  const options = { ...parameters, type: argon2id, hashLength: 32 } satisfies HashOptions;
  const verifier = await hash(password, options); // Native load and warm-up excluded.
  if (!await verify(verifier, password)) throw new Error("Argon2id round trip failed");
  if (await verify(verifier, randomBytes(32))) throw new Error("Argon2id accepted wrong password");
  const hashing = [];
  const verification = [];
  const concurrentBatches = [];
  for (let i = 0; i < samples; i += 1) {
    hashing.push(await measure(() => hash(password, options)));
    verification.push(await measure(() => verify(verifier, password)));
  }
  for (let i = 0; i < batchSamples; i += 1) {
    concurrentBatches.push(await measure(() => Promise.all(Array.from({ length: batchSize }, () => verify(verifier, password)))));
  }
  results.push({ name, parameters, hashing: stats(hashing), verification: stats(verification), concurrentBatchWallTime: stats(concurrentBatches) });
}
const require = createRequire(import.meta.url);
const packageVersion = (name: string): string => (require(`${name}/package.json`) as { version: string }).version;
console.log(JSON.stringify({
  schemaVersion: 1, measuredAt: new Date().toISOString(), productionPolicySelected: false,
  environment: {
    node: process.version, platform: process.platform, architecture: process.arch,
    cpu: cpus()[0]?.model, availableParallelism: availableParallelism(), totalMemoryBytes: totalmem(),
    uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? "4 (Node default)",
    processPeakRssKiB: process.resourceUsage().maxRSS,
    argon2: packageVersion("argon2"),
  },
  samplesPerOperation: samples, concurrentBatchSize: batchSize, concurrentBatchSamples: batchSamples,
  warmupExcluded: true, results,
}, null, 2));

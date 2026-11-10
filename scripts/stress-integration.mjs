// Runs N integration-test processes at the same time against the same base *_test database.
// With per-worker/per-run databases they must all pass; with a shared database they corrupt each other.
// Usage: npm run test:integration:stress -- [processes=3] [workersPerProcess=2]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const processes = Math.max(2, Number(process.argv[2] ?? 3));
const workers = Math.max(1, Number(process.argv[3] ?? 2));
const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');

const runs = Array.from({ length: processes }, (_, index) => new Promise((resolve) => {
  let output = '';
  const child = spawn(process.execPath, [vitest, 'run', 'tests/integration', `--maxWorkers=${workers}`], { env: process.env });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => resolve({ index: index + 1, code, summary: /Tests\s+(.*)/.exec(output)?.[1]?.trim() ?? 'no summary' }));
}));

const results = await Promise.all(runs);
for (const r of results) console.log(`process ${r.index}: exit=${r.code} ${r.summary}`);
const failed = results.filter((r) => r.code !== 0).length;
console.log(failed === 0 ? `PASS: ${processes} concurrent runs isolated.` : `FAIL: ${failed}/${processes} runs failed.`);
process.exit(failed === 0 ? 0 : 1);

// Full offline suite: fail on missing prerequisites or any failed child.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { root, pglite } = require('./llm-admission/runtime.cjs');
pglite(); // Preflight before printing any misleading partial success.
for (const suite of ['bypasses', 'operators', 'types', 'handlers', 'confirmation', 'adversarial']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, `test-llm-admission-${suite}.cjs`), root], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS all offline LLM admission suites');

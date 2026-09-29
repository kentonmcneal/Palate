// Offline test support. Source root is the sole tree under test, never an overlay.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
if (process.argv.length > 3) throw new Error('Usage: node SCRIPT [SOURCE_ROOT]');
for (const file of ['mobile/package.json', 'supabase/functions/_shared/llm-admission.mjs']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Incomplete admission source root: missing ${file} under ${root}`);
}
const mobileRequire = createRequire(path.join(root, 'mobile/package.json'));
function dependency(name) {
  try { return mobileRequire(name); }
  catch (error) { throw new Error(`Required existing mobile dependency ${name} is unavailable under ${root}`, { cause: error }); }
}
function pglite() {
  // Never install or silently skip SQL controls. Explicit paths are cwd-relative.
  try {
    return process.env.PGLITE_MODULE
      ? require(path.resolve(process.env.PGLITE_MODULE))
      : mobileRequire('@electric-sql/pglite');
  } catch (error) {
    throw new Error('PGlite required for offline SQL controls. Set PGLITE_MODULE to an existing @electric-sql/pglite module directory or CommonJS entry. No installation or skip was attempted.', { cause: error });
  }
}
global.fetch = () => { throw new Error('Uninjected live fetch forbidden'); };
module.exports = { root, repo: root, dependency, pglite, ts: dependency('typescript') };

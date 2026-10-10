// Data check: file schemas and links between them. Run: npm run check (the agent runs it after edits).
// --template checks this checkout's template/ instead (npm run check:template): set here, not through a
// shell variable, so the script also works in cmd.exe and from any folder.
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--template')) process.env.CRM_ROOT = fileURLToPath(new URL('../../template', import.meta.url));
// Imported after CRM_ROOT is set: config.ts resolves the workspace when it is first loaded.
const { loadAll } = await import('./store');
const { summary, validate } = await import('./validate');

await loadAll();
const problems = validate();
console.log(summary());
if (problems.length) {
  console.log(`\nПроблем: ${problems.length}`);
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(1);
}
console.log('ok');

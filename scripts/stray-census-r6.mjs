// stray-census-r6.mjs — round-6 INVERSE audit plane (read-only).
// The institutional verifier proves "manifest files exist in partner repos";
// THIS tool asks the opposite question: "what files exist in partner repos'
// docs/reports/ that the manifest does NOT know?" — stray/unknown content
// (including other agents' broadcasts) must be visible, never invisible.
// Zero keys (token via SAOS_GH_TOKEN_FILE), zero writes.
const tokenFile = process.env.SAOS_GH_TOKEN_FILE;
if (!tokenFile) {
  console.error('SAOS_GH_TOKEN_FILE required');
  process.exit(2);
}
const token = (await import('node:fs')).readFileSync(tokenFile, 'utf8').trim();

const manifest = JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL('./partner-reports.manifest.json', import.meta.url),
    'utf8'
  )
);
const known = new Set(Object.keys(manifest.files || {}));
const repos = manifest.repos || [];
const org = manifest.org; // NEVER hardcode — the manifest is the source of truth
const dir = manifest.dir || 'docs/reports';

const api = 'https://api.github.com';
async function gh(path) {
  const r = await fetch(api + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'saos-stray-census-r6',
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

let strays = 0;
const report = {};
const targeted = manifest.targeted || {}; // repo → files[] (expected only there)
for (const repo of repos) {
  const tree = await gh(`/repos/${org}/${repo}/contents/${dir}?ref=main`);
  if (!tree) {
    report[repo] = { error: `${dir} missing` };
    strays++;
    continue;
  }
  const repoKnown = new Set([...known, ...Object.keys(targeted[repo] || {})]);
  const files = tree.filter((x) => x.type === 'file').map((x) => x.name);
  const unknown = files.filter((f) => !repoKnown.has(f));
  report[repo] = { total: files.length, accounted: files.length - unknown.length, stray: unknown };
  if (unknown.length) {
    strays += unknown.length;
    console.log(`STRAY ${repo}: ${unknown.join(', ')}`);
  }
}
console.log(JSON.stringify({ org, dir, reposChecked: repos.length, manifestKnown: known.size, strayTotal: strays, report }, null, 1));
process.exit(0);

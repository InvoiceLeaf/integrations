// Publish-time bundler for the FinanzOnline integration.
//
// Unlike the ELSTER plugin (which is zero-dependency and builds with bare `tsc`),
// this plugin depends on the `fon-api` npm package to emit BMF-conformant XML. The
// InvoiceLeaf plugin-runtime never runs `npm install` on a plugin tarball: it
// downloads one tarball and esbuild-bundles `dist/index.js` under
// `platform: 'neutral'`. A bare `import 'fon-api/...'` left in dist would fail to
// resolve there. So we pre-bundle fon-api (+ its `zod` dep) into a self-contained
// dist/index.js here; the runtime then re-bundles that already-inlined file.
//
// The isolate provides NO Node globals (no Buffer/process/require, no `node:`
// builtins). We guard the output below and the plugin uses a pure-JS base64.
//
// fast-xml-parser IS bundled: fon-api uses it to parse BMF SOAP responses on the
// submit path (login/upload/logout). Its classic entry (fxp.js -> xmlparser/) is
// pure-string and isolate-safe; only its unused v5 streaming path references Buffer,
// and that path is not in fxp.js's import graph, so it is not bundled.

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// fon-api's `core` entry (which exports createClient, used on the submit path) is
// published as one bundle that statically includes its xmllint-based XSD VALIDATOR
// (src/validation/xsd.ts), which imports Node builtins and computes a package root
// from `import.meta.url` at module load. The submit path (login/upload/logout) never
// invokes the validator, so we alias those Node builtins to safe stubs: the load-time
// path/url calls return harmless values; the fs/child_process stubs (only reachable
// from the unused validateXml) throw if ever called. `import.meta.url` is defined to a
// literal so nothing leaks into the runtime's IIFE re-bundle.
const NODE_STUBS = {
  child_process:
    'export const execFileSync = () => { throw new Error("child_process is unavailable in the plugin sandbox"); };',
  fs:
    'export const existsSync = () => false;' +
    ' export const mkdtempSync = () => { throw new Error("fs is unavailable in the plugin sandbox"); };' +
    ' export const writeFileSync = () => { throw new Error("fs is unavailable in the plugin sandbox"); };',
  os: 'export const tmpdir = () => "/tmp";',
  path:
    'export const dirname = () => ".";' +
    ' export const join = (...a) => a.filter(Boolean).join("/");' +
    ' export const resolve = (...a) => "/" + a.filter(Boolean).join("/");',
  url: 'export const fileURLToPath = (u) => String(u ?? "");',
};

const stubNodeBuiltins = {
  name: 'stub-node-builtins',
  setup(b) {
    const filter = /^(?:node:)?(child_process|fs|os|path|url)$/;
    b.onResolve({ filter }, (args) => ({
      path: args.path.replace(/^node:/, ''),
      namespace: 'node-stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
      contents: NODE_STUBS[args.path] ?? 'export default {};',
      loader: 'js',
    }));
  },
};

const outfile = 'dist/index.js';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  // Resolve the deps' ESM entry points under platform:'neutral'.
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'default'],
  define: { 'import.meta.url': '"file:///plugin/index.js"' },
  outfile,
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [stubNodeBuiltins],
});

// Isolate-safety guard: the runtime isolate has no Node globals. A `node:` import or
// a reachable `Buffer` reference would throw at isolate load/run time, and esbuild
// emits them silently under platform:'neutral'.
const code = readFileSync(outfile, 'utf8');
const hardFails = [
  { re: /(^|[^.\w])require\s*\(/m, what: 'a CommonJS require() call' },
  { re: /from\s*["']node:/, what: "a 'node:' builtin import" },
  { re: /import\s*\(\s*["']node:/, what: "a dynamic 'node:' import" },
  // Real Buffer USAGE (not the word in a JSDoc `{string|Buffer}` comment).
  { re: /\bnew\s+Buffer\b/, what: 'a Buffer constructor (use the pure-JS base64 helper instead)' },
  {
    re: /\bBuffer\s*\.\s*(from|alloc|allocUnsafe|isBuffer|concat|of|byteLength)\b/,
    what: 'a Buffer.* call (use the pure-JS base64 helper instead)',
  },
];
const found = hardFails.filter((h) => h.re.test(code));
if (found.length > 0) {
  console.error('isolate-safety check FAILED — dist/index.js contains:');
  for (const h of found) console.error('  - ' + h.what);
  process.exit(1);
}

// Soft warning: process refs are usually typeof-guarded and safe, but worth surfacing.
if (/\bprocess\.\w/.test(code)) {
  console.warn('warning: dist/index.js references `process.*` — verify it is typeof-guarded (the isolate has no `process`).');
}

console.log(`bundled ${outfile} (${(code.length / 1024).toFixed(1)} KiB) — isolate-safety checks passed`);

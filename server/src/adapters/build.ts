import { build, type Message, type Plugin } from 'esbuild';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface AdapterBundle {
  // CommonJS that sets module.exports.
  code: string;
  // Source map with sources relative to the adapter folder.
  map: string;
}

export type BundleResult = { ok: true; bundle: AdapterBundle } | { ok: false; error: string };

// Adapter files may import only other files inside their own folder: no packages, no
// Node built-ins, nothing outside.
function folderOnly(root: string): Plugin {
  return {
    name: 'adapter-folder-only',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined;
        if (!args.path.startsWith('./') && !args.path.startsWith('../')) {
          return {
            errors: [
              {
                text: `Adapters cannot import "${args.path}"; only files in the adapters folder can be imported`,
              },
            ],
          };
        }
        const inside = relative(root, resolve(args.resolveDir, args.path));
        if (inside.startsWith('..') || isAbsolute(inside)) {
          return { errors: [{ text: `"${args.path}" is outside the adapters folder` }] };
        }
        return undefined;
      });
    },
  };
}

// One line per problem: file:line:column: text.
function formatMessages(root: string, messages: Message[]): string {
  return messages
    .map((message) => {
      const at = message.location;
      if (!at) return message.text;
      const file = relative(root, resolve(root, at.file)) || at.file;
      return `${file}:${at.line}:${at.column + 1}: ${message.text}`;
    })
    .join('\n');
}

// Bundles one adapter file and the files it imports into a single script.
export async function bundleAdapter(file: string, root: string): Promise<BundleResult> {
  try {
    const result = await build({
      entryPoints: [file],
      absWorkingDir: root,
      outfile: join(root, 'adapter.bundle.js'),
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'neutral',
      target: 'node22',
      sourcemap: 'external',
      sourcesContent: false,
      legalComments: 'none',
      logLevel: 'silent',
      tsconfigRaw: '{}',
      loader: { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.mts': 'ts', '.json': 'json' },
      plugins: [folderOnly(root)],
    });
    const code = result.outputFiles.find((output) => output.path.endsWith('.js'))?.text;
    const map = result.outputFiles.find((output) => output.path.endsWith('.map'))?.text;
    if (code === undefined || map === undefined) return { ok: false, error: 'esbuild produced no output' };
    return { ok: true, bundle: { code, map } };
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors;
    if (errors?.length) return { ok: false, error: formatMessages(root, errors) };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

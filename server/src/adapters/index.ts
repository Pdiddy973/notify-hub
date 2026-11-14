import type { ParseFormat } from './definition.js';

export {
  adapterFileSchema,
  configWithDefaults,
  type AdapterDefinition,
  type AdapterInput,
  type ParseFormat,
} from './definition.js';
export { AdapterHostClosed, ADAPTER_MEMORY_MB, ADAPTER_TIMEOUT_MS } from './host.js';
export {
  adapterTemplateFile,
  builtInAdapterDir,
  createAdapterLoader,
  type AdapterLoaderOptions,
  type AdapterRegistry,
  type LoadedAdapter,
  type SampleResult,
} from './loader.js';

// Turns a stored raw payload into the body an adapter receives.
export function parseBody(raw: string, format: ParseFormat): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(raw) as unknown;
    case 'form':
      return Object.fromEntries(new URLSearchParams(raw));
    case 'text':
      return raw;
  }
}

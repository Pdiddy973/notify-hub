// Notify Hub adapter template.
// Copy this file to a new name without the leading underscore, such as my-service.js, in the
// adapters folder; the hub loads it within a second and shows it on the Adapters page.
// Files starting with _ are never loaded as adapters, but adapters can import them as helpers.
// Adapters may import only other files in this folder: no npm packages and no node: modules.
// They run with the JavaScript built-ins only: no timers, no URL class, and console output
// is discarded.

export default {
  // Unique id: lowercase letters, numbers, and dashes. The same id as a built-in adapter
  // replaces that adapter.
  id: 'my-service',

  // Name shown in the type list when you add a source.
  name: 'My Service',

  // Your own version number, shown on the Adapters page.
  version: 1,

  // How the request body is read: 'json', 'form' (URL-encoded), or 'text'.
  parse: 'json',

  // Settings each source of this type can have; normalize receives them as config.
  config: {
    baseUrl: { type: 'string', label: 'Service URL', default: '' },
  },

  // Default look; per-source overrides come with the style editor.
  style: {
    icon: 'https://example.com/icon.png',
    colors: { error: '#e74c3c' },
  },

  // Turns one request into standard messages. Return [] to ignore the event on purpose.
  // Receives body, headers, and config, plus fetch when a fetch permission is approved.
  // Each message needs event, severity (info, success, warning, error, or debug), and title;
  // body, fields (up to 25 of { name, value, inline }), url, imageUrl, and key are optional.
  normalize({ body, config }) {
    return [
      {
        event: body.event,
        severity: body.ok ? 'success' : 'error',
        title: body.title,
        body: body.message,
        fields: [{ name: 'Host', value: String(body.host ?? 'unknown'), inline: true }],
        ...(config.baseUrl ? { url: config.baseUrl } : {}),
      },
    ];
  },

  // A declarative alternative to normalize for simple services; use one or the other.
  // {{body.x}}, {{headers.x}}, and {{config.x}} are filled from the request.
  // map: {
  //   event: '{{body.event}}',
  //   severity: { from: 'body.ok', values: { true: 'success', false: 'error' }, default: 'info' },
  //   title: '{{body.title}}',
  //   body: '{{body.message}}',
  //   fields: [{ name: 'Host', value: '{{body.host}}', inline: true }],
  // },

  // Example payloads: checked on every load, run by the Run samples button, and the first
  // one is sent by the source's test button. Save real payloads from your service here.
  samples: [
    {
      name: 'check passed',
      body: { event: 'check', ok: true, title: 'All good', message: 'Check passed', host: 'nas' },
    },
  ],

  // Setup steps shown on the source page, as plain text.
  help: 'Add the webhook URL from this page in My Service, under its notification settings.',

  // Network access, each entry approved on the Adapters page: fetch:<host> lets normalize
  // call fetch for that host only. Without an approved permission there is no fetch.
  permissions: [],
};

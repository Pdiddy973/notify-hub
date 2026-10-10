export interface Config {
  // LAN listener: ingest, health, web UI, and admin API.
  port: number;
  // Localhost listener for the tunnel: web UI and admin API only.
  tunnelPort: number;
  bodyLimitBytes: number;
}

export const defaultConfig: Config = {
  port: 8080,
  tunnelPort: 8081,
  bodyLimitBytes: 1024 * 1024,
};

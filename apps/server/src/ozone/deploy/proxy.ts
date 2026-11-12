/**
 * The proxy Ozone runs on a Docker host for the apps it deploys there with a domain: Traefik,
 * on ports 80 and 443, with certificates from Let's Encrypt. One per host, shared by its apps,
 * which it finds by their labels on a network of its own.
 */

export const PROXY_PROJECT = "ozone-proxy";
export const PROXY_CONTAINER = "ozone-proxy";
const PROXY_NETWORK = "ozone-proxy";
const PROXY_IMAGE = "traefik:v3.6";
const CERTIFICATE_RESOLVER = "letsencrypt";

/** Traefik's name for an app's router and service. */
export const routeName = (slug: string) => `ozone-${slug}`;

export const proxyComposeFile = (): string =>
  [
    `name: ${PROXY_PROJECT}`,
    "",
    "# Written by Ozone. It serves the apps Ozone deploys here with a domain.",
    "services:",
    "  proxy:",
    `    image: ${PROXY_IMAGE}`,
    `    container_name: ${PROXY_CONTAINER}`,
    "    restart: unless-stopped",
    "    command:",
    ...[
      "--providers.docker=true",
      "--providers.docker.exposedbydefault=false",
      `--providers.docker.network=${PROXY_NETWORK}`,
      "--entrypoints.web.address=:80",
      "--entrypoints.web.http.redirections.entrypoint.to=websecure",
      "--entrypoints.web.http.redirections.entrypoint.scheme=https",
      "--entrypoints.websecure.address=:443",
      // Its dashboard and API answer only inside the container, where Ozone asks it.
      "--entrypoints.traefik.address=127.0.0.1:8080",
      "--api=true",
      "--api.insecure=true",
      "--ping=true",
      `--certificatesresolvers.${CERTIFICATE_RESOLVER}.acme.storage=/certificates/acme.json`,
      `--certificatesresolvers.${CERTIFICATE_RESOLVER}.acme.httpchallenge.entrypoint=web`,
      // A request sent to a version that just stopped is retried on the new one within a second.
      "--serversTransport.forwardingTimeouts.dialTimeout=1s",
    ].map((arg) => `      - ${arg}`),
    "    ports:",
    '      - "80:80"',
    '      - "443:443"',
    "    volumes:",
    "      - /var/run/docker.sock:/var/run/docker.sock:ro",
    "      - certificates:/certificates",
    "    networks:",
    "      - proxy",
    "    healthcheck:",
    '      test: ["CMD", "traefik", "healthcheck", "--ping"]',
    "      interval: 10s",
    "      timeout: 5s",
    "      retries: 3",
    "      start_period: 30s",
    "      start_interval: 1s",
    "",
    "networks:",
    "  proxy:",
    `    name: ${PROXY_NETWORK}`,
    "",
    "volumes:",
    "  certificates:",
    "",
  ].join("\n");

/**
 * What an app's production override adds to be served at `domain`: no port of its own, the
 * proxy's network, and the labels the proxy routes by. Without a published port, a second copy
 * can start beside the first during a deploy.
 */
export const routeOverride = (input: {
  readonly slug: string;
  readonly domain: string;
  readonly appPort: number;
}): ReadonlyArray<string> => {
  const name = routeName(input.slug);
  const labels: ReadonlyArray<readonly [string, string]> = [
    ["traefik.enable", "true"],
    ["traefik.docker.network", PROXY_NETWORK],
    [`traefik.http.routers.${name}.rule`, `Host(\`${input.domain}\`)`],
    [`traefik.http.routers.${name}.entrypoints`, "websecure"],
    [`traefik.http.routers.${name}.tls.certresolver`, CERTIFICATE_RESOLVER],
    [`traefik.http.routers.${name}.middlewares`, `${name}-retry`],
    [`traefik.http.middlewares.${name}-retry.retry.attempts`, "3"],
    [`traefik.http.services.${name}.loadbalancer.server.port`, String(input.appPort)],
  ];
  return [
    "    ports: !reset []",
    "    networks:",
    "      - default",
    `      - ${PROXY_NETWORK}`,
    "    labels:",
    ...labels.map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`),
  ];
};

export const proxyNetworkDeclaration: ReadonlyArray<string> = [
  "networks:",
  `  ${PROXY_NETWORK}:`,
  "    external: true",
];

/** How many copies of the app the proxy sends requests to, from its API's answer. */
export const proxiedServers = (json: string): number => {
  try {
    const service = JSON.parse(json) as {
      readonly loadBalancer?: { readonly servers?: ReadonlyArray<unknown> };
    };
    return service.loadBalancer?.servers?.length ?? 0;
  } catch {
    return 0;
  }
};

/**
 * Hub mode: one office over several machines (nodes). Every node runs a normal
 * standalone server with its own account, repos, hooks and terminals; the hub
 * owns only the office itself (layout, seats, settings) and speaks to each
 * node over the node's own protocol, as a privileged client.
 *
 * Node addresses are plain URLs, so it makes no difference how the node is
 * reached: a Tailscale name (`https://pc.tailnet.ts.net/?token=...`) or an SSH
 * tunnel to its loopback port (`http://127.0.0.1:3101/?token=...`).
 */

/** Hub ids are node-scoped: (index + 1) * stride + the node's own id. */
export const HUB_ID_STRIDE = 10_000_000;

/** Separator between node name and path in a Directory path the hub hands out. */
const NODE_PATH_SEPARATOR = '::';

export interface HubNodeConfig {
  name: string;
  /** Base http(s) URL of the node, without the token. */
  baseUrl: string;
  token: string;
}

/** Parse one `--node name=url` value. The token rides the URL's `?token=`. */
export function parseNodeArg(raw: string): HubNodeConfig {
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new Error(`Expected name=url, got "${raw}"`);
  const name = raw.slice(0, eq).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid node name "${name}": letters, digits, - and _ only.`);
  }
  let url: URL;
  try {
    url = new URL(raw.slice(eq + 1).trim());
  } catch {
    throw new Error(`Invalid URL for node "${name}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Node "${name}" needs an http(s) URL.`);
  }
  const token = url.searchParams.get('token');
  if (!token) throw new Error(`Node "${name}" URL has no ?token=.`);
  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return { name, baseUrl, token };
}

export function wsUrl(node: HubNodeConfig, pathname: string): string {
  const base = node.baseUrl.replace(/^http/, 'ws');
  return `${base}${pathname}?token=${encodeURIComponent(node.token)}`;
}

export function toHubId(nodeIndex: number, localId: number): number {
  return (nodeIndex + 1) * HUB_ID_STRIDE + localId;
}

export function fromHubId(hubId: number): { nodeIndex: number; localId: number } | null {
  if (!Number.isInteger(hubId) || hubId < HUB_ID_STRIDE) return null;
  return { nodeIndex: Math.floor(hubId / HUB_ID_STRIDE) - 1, localId: hubId % HUB_ID_STRIDE };
}

export function encodeNodePath(node: string, path: string): string {
  return `${node}${NODE_PATH_SEPARATOR}${path}`;
}

export function decodeNodePath(encoded: string): { node: string; path: string } | null {
  const at = encoded.indexOf(NODE_PATH_SEPARATOR);
  if (at <= 0) return null;
  return { node: encoded.slice(0, at), path: encoded.slice(at + NODE_PATH_SEPARATOR.length) };
}

/**
 * Hub mode's /terminal/:agentId: the PTY lives on a node, so the hub checks the
 * browser's handshake exactly like a node would, then pipes frames both ways
 * to the node's own terminal socket for that agent.
 */

import type { FastifyInstance } from 'fastify';

import { TERMINAL_WS_PREFIX } from '../../../core/src/constants.js';
import {
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_NO_SESSION,
  WS_CLOSE_UNAUTHORIZED,
} from '../constants.js';
import { isAllowedWebSocketOrigin, standaloneHandshakeVerdict } from '../wsAuth.js';
import { fromHubId, type HubNodeConfig, wsUrl } from './hubNodes.js';
import type { HubSocketFactory } from './hubSession.js';

const WS_OPEN = 1;

interface BrowserSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
}

export function registerHubTerminalRoute(
  app: FastifyInstance,
  options: {
    token: string;
    allowedHostnames: ReadonlySet<string>;
    nodes: HubNodeConfig[];
    socketFactory: HubSocketFactory;
  },
): void {
  app.get<{ Params: { agentId: string } }>(
    `${TERMINAL_WS_PREFIX}/:agentId`,
    { websocket: true },
    (socket: BrowserSocket, request) => {
      const verdict = standaloneHandshakeVerdict(
        request.url,
        request.headers.host,
        options.token,
        options.allowedHostnames,
      );
      if (verdict === 'bad-token') {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      if (
        verdict === 'untrusted-host' ||
        !isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)
      ) {
        socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
        return;
      }
      const target = fromHubId(Number(request.params.agentId));
      const node = target ? options.nodes[target.nodeIndex] : undefined;
      if (!target || !node) {
        socket.close(WS_CLOSE_NO_SESSION, 'no terminal for agent');
        return;
      }

      const upstream = options.socketFactory(
        wsUrl(node, `${TERMINAL_WS_PREFIX}/${target.localId}`),
      );
      const pending: string[] = [];
      upstream.addEventListener('open', () => {
        for (const frame of pending.splice(0)) upstream.send(frame);
      });
      upstream.addEventListener('message', (event) => {
        if (socket.readyState === WS_OPEN) socket.send(String(event.data));
      });
      upstream.addEventListener('close', () => {
        if (socket.readyState === WS_OPEN) socket.close(WS_CLOSE_NO_SESSION, 'node closed');
      });
      upstream.addEventListener('error', () => {});
      socket.on('message', (data) => {
        const frame = data.toString();
        if (upstream.readyState === WS_OPEN) upstream.send(frame);
        else pending.push(frame);
      });
      socket.on('close', () => upstream.close());
    },
  );
}

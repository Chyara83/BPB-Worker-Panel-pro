import { fallback } from '@handlers';
import { VlOverWSHandler } from '@vless';
import { TrOverWSHandler } from '@trojan';
import { HttpStatus } from '@common';

export async function handleCommercialWebsocket(request: Request, env: Env): Promise<Response> {
    const encodedPathConfig = new URL(request.url).pathname.replace(/^\//, '');
    try {
        const { protocol, mode, panelIPs } = JSON.parse(atob(encodedPathConfig));
        console.log({
            event: 'commercial_websocket_request',
            protocol,
            mode,
            panelIPsCount: Array.isArray(panelIPs) ? panelIPs.length : 0,
            pathLength: encodedPathConfig.length
        });
        globalThis.wsConfig = { ...globalThis.wsConfig, wsProtocol: protocol, proxyMode: mode, panelIPs };
        switch (protocol) {
            case 'vl': return await VlOverWSHandler(request, env);
            case 'tr': return await TrOverWSHandler(request, env);
            default: return await fallback(request);
        }
    } catch (error) {
        console.error('commercial_websocket_path_parse_failed', error);
        return new Response('Failed to parse WebSocket path config', { status: HttpStatus.BAD_REQUEST });
    }
}

import { fallback } from '@handlers';
import { VlOverWSHandler } from '@vless';
import { TrOverWSHandler } from '@trojan';
import { HttpStatus } from '@common';

export async function handleCommercialWebsocket(request: Request, env: Env): Promise<Response> {
    const encodedPathConfig = new URL(request.url).pathname.replace(/^\//, '');
    console.log({
        event: 'commercial_ws_route',
        pathLength: encodedPathConfig.length,
        upgrade: request.headers.get('Upgrade'),
        host: request.headers.get('Host')
    });
    try {
        const decoded = atob(encodedPathConfig);
        const config = JSON.parse(decoded);
        const { protocol, mode, panelIPs } = config;
        console.log({
            event: 'commercial_ws_route_parsed',
            protocol,
            mode,
            panelIPCount: Array.isArray(panelIPs) ? panelIPs.length : 0
        });
        globalThis.wsConfig = { ...globalThis.wsConfig, wsProtocol: protocol, proxyMode: mode, panelIPs };
        switch (protocol) {
            case 'vl': return await VlOverWSHandler(request, env);
            case 'tr': return await TrOverWSHandler(request, env);
            default:
                console.error({ event: 'commercial_ws_unknown_protocol', protocol });
                return await fallback(request);
        }
    } catch (error) {
        console.error({
            event: 'commercial_ws_route_failed',
            pathLength: encodedPathConfig.length,
            message: String(error)
        });
        return new Response('Failed to parse WebSocket path config', { status: HttpStatus.BAD_REQUEST });
    }
}

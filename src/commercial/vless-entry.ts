import { env as workerEnv } from 'cloudflare:workers';
import { VlOverWSHandler as implementation } from '../protocols/websocket/vless';

export function VlOverWSHandler(request: Request, env: Env = workerEnv): Promise<Response> {
    return implementation(request, env);
}

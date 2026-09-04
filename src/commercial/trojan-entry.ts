import { env as workerEnv } from 'cloudflare:workers';
import { TrOverWSHandler as implementation } from '../protocols/websocket/trojan';

export function TrOverWSHandler(request: Request, env: Env = workerEnv as unknown as Env): Promise<Response> {
    return implementation(request, env);
}

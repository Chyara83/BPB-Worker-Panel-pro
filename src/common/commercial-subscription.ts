import { setSettings } from '@init';
import { getClNormalConfig } from '@clash/configs';
import { getSbCustomConfig } from '@sing-box/configs';
import { getXrCustomConfigs } from '@xray/configs';
import { findUserBySubPath, getStatus, type UserData } from '@users';
import { getUserUsage } from '@commercial/usage';

async function replaceCredentials(response: Response, env: Env, user: UserData): Promise<Response> {
    const text = await response.text();
    const vless = user.vlessUUID || env.UUID;
    const trojan = user.trojanPassword || env.TR_PASS;
    const replaced = text.split(env.UUID).join(vless).split(env.TR_PASS).join(trojan);
    return new Response(replaced, { status: response.status, headers: response.headers });
}

export async function handleCommercialUserSub(request: Request, env: Env): Promise<Response> {
    const segments = new URL(request.url).pathname.split('/');
    const userSubPath = segments[3];
    if (!userSubPath) return new Response('Not found', { status: 404 });
    const user = await findUserBySubPath(userSubPath, env);
    if (!user) return new Response('Subscription not found.', { status: 404 });
    if (getStatus(user) !== 'active') return new Response('Your subscription is inactive or expired.', { status: 403 });
    const usage = await getUserUsage(user, env);
    if (user.quotaBytes > 0 && usage.usedBytes >= user.quotaBytes) return new Response('Your traffic quota has been exhausted.', { status: 403 });
    const url = new URL(request.url);
    const app = decodeURIComponent(url.searchParams.get('app') ?? '');
    if (app) (globalThis.httpConfig as any).client = app;
    await setSettings(request, env);
    let response: Response;
    switch (globalThis.httpConfig.client) {
        case 'sing-box': response = await getSbCustomConfig(false); break;
        case 'clash': response = await getClNormalConfig(); break;
        default: response = await getXrCustomConfigs(false); break;
    }
    return replaceCredentials(response, env, user);
}

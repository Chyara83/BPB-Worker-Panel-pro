import { setSettings } from '@init';
import { getClNormalConfig } from '@clash/configs';
import { getSbCustomConfig } from '@sing-box/configs';
import { getXrCustomConfigs } from '@xray/configs';
import { findUserBySubPath, getStatus } from '@users';
import { HttpStatus } from '@common';

async function replaceCredentials(response: Response, env: Env, user: UserData): Promise<Response> {
    const text = await response.text();
    const globalUUID = env.UUID;
    const globalPassword = env.TR_PASS;
    const replaced = text.split(globalUUID).join(user.vlessUUID).split(globalPassword).join(user.trojanPassword);
    return new Response(replaced, {
        status: response.status,
        headers: response.headers
    });
}

export async function handleCommercialUserSub(request: Request, env: Env): Promise<Response> {
    const pathName = globalThis.globalConfig.pathName;
    const segments = pathName.split('/');
    const userSubPath = segments[3];
    if (!userSubPath) return new Response('Not found', { status: 404 });

    const user = await findUserBySubPath(userSubPath, env);
    if (!user) return new Response('Subscription not found.', { status: 404 });
    if (getStatus(user) !== 'active') return new Response('Your subscription is inactive or expired.', { status: 403 });

    const app = decodeURIComponent(new URL(request.url).searchParams.get('app') ?? '');
    if (app) globalThis.httpConfig.client = app;
    await setSettings(request, env);

    let response: Response;
    switch (globalThis.httpConfig.client) {
        case 'sing-box': response = await getSbCustomConfig(false); break;
        case 'clash': response = await getClNormalConfig(); break;
        default: response = await getXrCustomConfigs(false); break;
    }
    return await replaceCredentials(response, env, user);
}

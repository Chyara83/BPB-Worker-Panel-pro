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
    const hasDefaultUuid = !!env.UUID && text.includes(env.UUID);
    const hasDefaultTrojan = !!env.TR_PASS && text.includes(env.TR_PASS);
    const replaced = text.split(env.UUID).join(vless).split(env.TR_PASS).join(trojan);
    const hasUserUuid = !!vless && replaced.includes(vless);
    const hasUserTrojan = !!trojan && replaced.includes(trojan);
    console.log({
        event: 'commercial_sub_credentials',
        user: user.username,
        responseBytes: new TextEncoder().encode(replaced).byteLength,
        defaultUuidPresent: hasDefaultUuid,
        userUuidPresent: hasUserUuid,
        defaultTrojanPresent: hasDefaultTrojan,
        userTrojanPresent: hasUserTrojan
    });

    // Never return a panel-level credential if the generated user config did not
    // actually contain a user credential after replacement.
    const client = globalThis.httpConfig.client || 'xray';
    const validUserConfig = client === 'clash'
        ? hasUserUuid || hasUserTrojan
        : client === 'sing-box'
            ? hasUserUuid || hasUserTrojan
            : hasUserUuid || hasUserTrojan;
    if (!validUserConfig) {
        console.error({ event: 'commercial_sub_credential_replacement_failed', user: user.username, client });
        return new Response('Failed to generate a valid user subscription.', {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    return new Response(replaced, { status: response.status, headers: response.headers });
}

export async function handleCommercialUserSub(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const userSubPath = segments[3];
    console.log({
        event: 'commercial_sub_request',
        method: request.method,
        path: url.pathname,
        subPathPresent: !!userSubPath,
        app: url.searchParams.get('app') || 'default'
    });
    if (!userSubPath) return new Response('Not found', { status: 404 });

    const user = await findUserBySubPath(userSubPath, env);
    console.log({
        event: 'commercial_sub_user_lookup',
        found: !!user,
        username: user?.username,
        status: user ? getStatus(user) : 'none'
    });
    if (!user) return new Response('Subscription not found.', { status: 404 });
    if (getStatus(user) !== 'active') return new Response('Your subscription is inactive or expired.', { status: 403 });

    const usage = await getUserUsage(user, env);
    console.log({
        event: 'commercial_sub_usage',
        username: user.username,
        usedBytes: usage.usedBytes,
        quotaBytes: user.quotaBytes,
        activeSessions: usage.activeSessions
    });
    if (user.quotaBytes > 0 && usage.usedBytes >= user.quotaBytes) return new Response('Your traffic quota has been exhausted.', { status: 403 });

    const app = decodeURIComponent(url.searchParams.get('app') ?? '');
    if (app) (globalThis.httpConfig as any).client = app;
    await setSettings(request, env);

    let response: Response;
    switch (globalThis.httpConfig.client) {
        case 'sing-box': response = await getSbCustomConfig(false); break;
        case 'clash': response = await getClNormalConfig(); break;
        default: response = await getXrCustomConfigs(false); break;
    }

    console.log({
        event: 'commercial_sub_generated',
        username: user.username,
        client: globalThis.httpConfig.client || 'xray',
        status: response.status
    });
    return replaceCredentials(response, env, user);
}

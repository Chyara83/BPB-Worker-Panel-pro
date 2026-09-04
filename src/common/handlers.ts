import { Authenticate, generateJWTToken, resetPassword } from "@auth";
import { getDataset, updateDataset } from "@kv";
import { setSettings } from "@init";
import { getClNormalConfig, getClWarpConfig } from "@clash/configs";
import { getSbCustomConfig, getSbWarpConfig } from "@sing-box/configs";
import { getXrCustomConfigs, getXrWarpConfigs } from "@xray/configs";
import { fetchWarpAccounts } from "@warp";
import { VlOverWSHandler } from "@vless";
import { TrOverWSHandler } from "@trojan";
import { base64DecodeUtf8, base64EncodeUtf8, HttpStatus, respond, safeErrorMessage } from '@common';
import { generateRemark, generateWsPath, getConfigAddresses, randomUpperCase, resolveDNS } from '@utils';
import { listUsers, createUser, getUser, updateUser, deleteUser, getStatus, findUserBySubPath, type UserData } from '@users';
import JSZip from 'jszip';

export async function handleWebsocket(request: Request): Promise<Response> {
    const { pathName } = globalThis.globalConfig;
    const encodedPathConfig = pathName.replace("/", "");
    try {
        const { protocol, mode, panelIPs } = JSON.parse(atob(encodedPathConfig));
        globalThis.wsConfig = { ...globalThis.wsConfig, wsProtocol: protocol, proxyMode: mode, panelIPs };
        switch (protocol) {
            case 'vl': return await VlOverWSHandler(request);
            case 'tr': return await TrOverWSHandler(request);
            default: return await fallback(request);
        }
    } catch (error) { return new Response('Failed to parse WebSocket path config', { status: HttpStatus.BAD_REQUEST }); }
}

export async function handlePanel(request: Request, env: Env): Promise<Response> {
    const { pathName } = globalThis.globalConfig;
    switch (pathName) {
        case '/panel': return await renderPanel(request, env);
        case '/panel/settings': return await getSettings(request, env);
        case '/panel/update-settings': return await updateSettings(request, env);
        case '/panel/reset-settings': return await resetSettings(request, env);
        case '/panel/reset-password': return await resetPassword(request, env);
        case '/panel/my-ip': return await getMyIP(request);
        case '/panel/update-warp': return await updateWarpConfigs(request, env);
        case '/panel/get-warp-configs': return await getWarpConfigs(request, env);
        case '/panel/cf-usage': return await getCfUsage(request, env);
        case '/panel/setup-telegram-webhook': return await setupTelegramWebhook(request, env);
        case '/panel/users':
        case '/panel/users/': return await handleUsers(request, env);
        default:
            if (pathName.startsWith('/panel/users/')) return await handleUsers(request, env);
            return await fallback(request);
    }
}

export async function handleProxyIPs(request: Request, env: Env): Promise<Response> {
    const auth = await Authenticate(request, env);
    if (!auth) return Response.redirect(`${globalThis.httpConfig.urlOrigin}/login`, 302);
    if (globalThis.globalConfig.pathName === '/proxy-ip') return await renderProxyIPs();
    if (globalThis.globalConfig.pathName === '/proxy-ip/get') return await getProxyIPsInfo();
    return await fallback(request);
}

export async function renderError(error: any): Promise<Response> {
    const html = await decompressHtml(__ERROR_HTML_CONTENT__, true) as string;
    return new Response(html.replace('__ERROR_MESSAGE__', safeErrorMessage(error)), { status: HttpStatus.OK, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
async function renderProxyIPs() { const html = await decompressHtml(__PROXY_IP_HTML_CONTENT__, false); return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
export async function handleLogin(request: Request, env: Env): Promise<Response> { const { pathName } = globalThis.globalConfig; if (pathName === '/login') return await renderLogin(request, env); if (pathName === '/login/authenticate') return await generateJWTToken(request, env); return await fallback(request); }
export function logout(): Response { return respond(true, HttpStatus.OK, 'Successfully logged out!', null, { 'Set-Cookie': 'jwtToken=; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Content-Type': 'text/plain' }); }

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    await setSettings(request, env);
    const { globalConfig: { pathName }, httpConfig: { client, subPath } } = globalThis;
    switch (pathName) {
        case `/sub/normal/${subPath}`:
            switch (client) {
                case 'xray': return await getXrCustomConfigs(false);
                case 'sing-box': return await getSbCustomConfig(false);
                case 'clash': return await getClNormalConfig();
            }
        case `/sub/raw/${subPath}`:
            switch (client) { case 'xray': case 'sing-box': return await getURLConfigs(); }
        case `/sub/fragment/${subPath}`:
            switch (client) { case 'xray': return await getXrCustomConfigs(true); case 'sing-box': return await getSbCustomConfig(true); }
        case `/sub/warp/${subPath}`:
            switch (client) { case 'xray': return await getXrWarpConfigs(request, env, false, false); case 'sing-box': return await getSbCustomConfig(false); case 'clash': return await getClWarpConfig(request, env, false); }
        case `/sub/warp-pro/${subPath}`:
            switch (client) { case 'xray': return await getXrWarpConfigs(request, env, true, false); case 'xray-knocker': return await getXrWarpConfigs(request, env, true, true); case 'clash': return await getClWarpConfig(request, env, true); }
        default: return await fallback(request);
    }
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    if (!await Authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    try { const proxySettings = await updateDataset(request, env); return respond(true, HttpStatus.OK, '', proxySettings); }
    catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while updating settings: ${safeErrorMessage(error)}`); }
}
async function resetSettings(request: Request, env: Env): Promise<Response> { if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed!'); if (!await Authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.'); try { const { settings } = globalThis; await env.kv.put('proxySettings', JSON.stringify(settings)); return respond(true, HttpStatus.OK, '', settings); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while resetting settings: ${safeErrorMessage(error)}`); } }

async function getCfUsage(request: Request, env: Env): Promise<Response> {
    if (!await Authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    try {
        const { settings } = await getDataset(request, env); const { cfAccountId, cfApiToken, cfWorkerName } = settings;
        if (!cfAccountId || !cfApiToken || !cfWorkerName) return respond(false, HttpStatus.BAD_REQUEST, 'CF credentials not configured.');
        const today = new Date().toISOString().split('T')[0];
        const graphqlQuery = { query: `{ viewer { accounts(filter: {accountTag: "${cfAccountId}"}) { workersInvocationsAdaptive(limit: 100, filter: { scriptName: "${cfWorkerName}", datetime_geq: "${today}T00:00:00Z", datetime_leq: "${today}T23:59:59Z" }) { sum { requests subrequests errors } } } } }` };
        const gqlRes = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${cfApiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(graphqlQuery) });
        const gqlData: any = await gqlRes.json(); let requestsUsed = 0, subrequestsUsed = 0, errors = 0;
        const sums = gqlData?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
        for (const entry of sums) if (entry.sum) { requestsUsed += entry.sum.requests || 0; subrequestsUsed += entry.sum.subrequests || 0; errors += entry.sum.errors || 0; }
        const requestsLimit = 100000, observabilityLimit = 200000; const requestsPercent = Math.round(requestsUsed / requestsLimit * 10000) / 100; const observabilityPercent = Math.round((subrequestsUsed + errors) / observabilityLimit * 10000) / 100;
        const warnings: string[] = []; if (requestsPercent > 80) warnings.push(`Requests today: ${requestsPercent}% used.`); if (observabilityPercent > 80) warnings.push(`Observability today: ${observabilityPercent}% used.`);
        const nearLimit = warnings.length > 0, overLimit = requestsPercent >= 100 || observabilityPercent >= 100; const startOfMonth = new Date(); startOfMonth.setDate(1); const period = `${startOfMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        return respond(true, HttpStatus.OK, '', { period, today, requests: { used: requestsUsed, limit: requestsLimit, percent: requestsPercent }, observability: { used: subrequestsUsed + errors, limit: observabilityLimit, percent: observabilityPercent }, overLimit, nearLimit, warnings });
    } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error fetching CF usage: ${safeErrorMessage(error)}`); }
}

async function setupTelegramWebhook(request: Request, env: Env): Promise<Response> { const auth = await Authenticate(request, env); if (!auth) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.'); const proxySettings: any = await env.kv.get('proxySettings', { type: 'json' }); const token: string = proxySettings?.telegramBotToken; if (!token) return respond(false, HttpStatus.BAD_REQUEST, 'Bot token not set in settings.'); const webhookUrl = `${globalThis.httpConfig.urlOrigin}/telegram`; try { const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`); const data: any = await res.json(); if (!data.ok) return respond(false, HttpStatus.BAD_REQUEST, data.description || 'Failed to set webhook.'); await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands: [{ command: 'start', description: '🤖 Show welcome menu' }, { command: 'config', description: '📥 Get subscription config' }, { command: 'qr', description: '📱 Get QR codes' }, { command: 'info', description: '⚙️ Show settings info' }, { command: 'users', description: '👥 User management' }] }) }); return respond(true, HttpStatus.OK, 'Telegram webhook set successfully!', { url: webhookUrl }); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }

async function getSettings(request: Request, env: Env): Promise<Response> { const isPassSet = Boolean(await env.kv.get('pwd')); if (!await Authenticate(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.', { isPassSet }); try { const dataset = await getDataset(request, env); return respond(true, HttpStatus.OK, undefined, { proxySettings: dataset.settings, isPassSet, subPath: globalThis.httpConfig.subPath }); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while fetching settings: ${safeErrorMessage(error)}`); } }
async function userAuth(request: Request, env: Env): Promise<boolean> { const pwd = await env.kv.get('pwd'); if (!pwd) return true; return await Authenticate(request, env); }

async function handleUsers(request: Request, env: Env): Promise<Response> {
    if (!await userAuth(request, env)) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    const { pathName } = globalThis.globalConfig; const method = request.method;
    if (pathName === '/panel/users' || pathName === '/panel/users/') {
        if (method === 'GET') { try { return respond(true, HttpStatus.OK, '', await listUsers(env)); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }
        if (method === 'POST') { try { const body: { username?: string; days?: number; note?: string; maxConnections?: number } = await request.json(); const result = await createUser(body.username || '', body.days || 30, body.note || '', env, body.maxConnections || 1); if (!result.success) return respond(false, HttpStatus.BAD_REQUEST, result.message); return respond(true, HttpStatus.OK, result.message, result.user); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }
    const username = pathName.replace('/panel/users/', ''); if (!username) return respond(false, HttpStatus.NOT_FOUND, 'User not found.');
    if (method === 'GET') { try { const user = await getUser(username, env); if (!user) return respond(false, HttpStatus.NOT_FOUND, 'User not found.'); return respond(true, HttpStatus.OK, '', user); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }
    if (method === 'PUT') { try { const body: { days?: number; note?: string; active?: boolean; maxConnections?: number } = await request.json(); const result = await updateUser(username, body, env); if (!result.success) return respond(false, HttpStatus.NOT_FOUND, result.message); return respond(true, HttpStatus.OK, result.message, result.user); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }
    if (method === 'DELETE') { try { const result = await deleteUser(username, env); if (!result.success) return respond(false, HttpStatus.NOT_FOUND, result.message); return respond(true, HttpStatus.OK, result.message); } catch (error) { return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`); } }
    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

export async function handleUserSub(request: Request, env: Env): Promise<Response> {
    const segments = globalThis.globalConfig.pathName.split('/'); const userSubPath = segments[3]; if (!userSubPath) return new Response('Not found', { status: 404 });
    const user = await findUserBySubPath(userSubPath, env);
    if (!user) return new Response('Subscription not found.', { status: 404 });
    if (getStatus(user) !== 'active') return new Response('Subscription is disabled or expired.', { status: 403 });

    const panelSubPath = globalThis.httpConfig.subPath;
    const originalPath = globalThis.globalConfig.pathName;
    (globalThis.globalConfig as any).pathName = `/sub/normal/${panelSubPath}`;
    (globalThis.globalConfig as any).userID = user.vlessUUID;
    (globalThis.globalConfig as any).TrPass = user.trojanPassword;
    const url = new URL(request.url); const app = decodeURIComponent(url.searchParams.get('app') ?? ''); if (app) (globalThis.httpConfig as any).client = app;
    await setSettings(request, env);
    try {
        const client = globalThis.httpConfig.client;
        switch (client) { case 'sing-box': return await getSbCustomConfig(false); case 'clash': return await getClNormalConfig(); default: return await getXrCustomConfigs(false); }
    } catch (error) { return new Response(`Config error: ${safeErrorMessage(error)}`, { status: 500 }); }
    finally { (globalThis.globalConfig as any).pathName = originalPath; }
}

export async function fallback(request: Request): Promise<Response> { const { fallbackDomain } = globalThis.globalConfig; const { url, method, headers, body } = request; const newURL = new URL(url); newURL.hostname = fallbackDomain; newURL.protocol = 'https:'; return await fetch(new Request(newURL.toString(), { method, headers, body, redirect: 'manual' })); }

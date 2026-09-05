import { Authenticate } from '@auth';
import { getUser, getStatus } from '@users';

interface ExternalConfig {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    priority: number;
    assignedUsername?: string;
    createdAt: string;
    lastCheckAt?: string;
    lastLatencyMs?: number;
    lastStatus?: number;
    lastError?: string;
}

const INDEX = 'external-configs:index';
const key = (id: string) => `external-config:${id}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function admin(request: Request, env: Env) { const pwd = await env.kv.get('pwd'); return !pwd || await Authenticate(request, env); }
function validUrl(value: unknown): value is string { try { const u = new URL(String(value)); return u.protocol === 'https:' && !!u.hostname && !/^(localhost|127(?:\\.|$)|0\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(?:1[6-9]|2\\d|3[0-1])\\.|::1$)/i.test(u.hostname); } catch { return false; } }
async function list(env: Env): Promise<ExternalConfig[]> { const ids: string[] = await env.kv.get(INDEX, { type: 'json' }) || []; return (await Promise.all(ids.map(id => env.kv.get(key(id), { type: 'json' }) as Promise<ExternalConfig | null>))).filter((x): x is ExternalConfig => !!x); }
function id() { return crypto.randomUUID(); }

export async function handleCommercialExternalConfigs(request: Request, env: Env): Promise<Response> {
    if (!(await admin(request, env))) return json({ success: false, message: 'Unauthorized.' }, 401);
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    const configId = parts[2] || '';
    try {
        if (!configId && request.method === 'GET') return json({ success: true, body: await list(env) });
        if (!configId && request.method === 'POST') {
            const body = await request.json<{ name?: string; url?: string; priority?: number; assignedUsername?: string }>();
            if (!body.name?.trim() || !validUrl(body.url)) return json({ success: false, message: 'Name and a public HTTPS URL are required.' }, 400);
            if (body.assignedUsername && !(await getUser(body.assignedUsername, env))) return json({ success: false, message: 'Assigned user not found.' }, 400);
            const item: ExternalConfig = { id: id(), name: body.name.trim().slice(0, 80), url: body.url, enabled: true, priority: Number.isFinite(body.priority) ? Math.max(0, Math.min(100, Math.floor(body.priority!))) : 50, assignedUsername: body.assignedUsername || undefined, createdAt: new Date().toISOString() };
            const ids: string[] = await env.kv.get(INDEX, { type: 'json' }) || []; ids.push(item.id);
            await env.kv.put(key(item.id), JSON.stringify(item)); await env.kv.put(INDEX, JSON.stringify(ids));
            return json({ success: true, message: 'External config created.', body: item }, 201);
        }
        if (!configId) return json({ success: false, message: 'Method not allowed.' }, 405);
        const item = await env.kv.get(key(configId), { type: 'json' }) as ExternalConfig | null;
        if (!item) return json({ success: false, message: 'External config not found.' }, 404);
        if (request.method === 'GET') return json({ success: true, body: item });
        if (request.method === 'PUT') {
            const body = await request.json<Partial<Pick<ExternalConfig, 'name' | 'url' | 'enabled' | 'priority' | 'assignedUsername'>>>();
            if (body.url !== undefined && !validUrl(body.url)) return json({ success: false, message: 'Only public HTTPS URLs are allowed.' }, 400);
            if (body.assignedUsername && !(await getUser(body.assignedUsername, env))) return json({ success: false, message: 'Assigned user not found.' }, 400);
            if (body.name !== undefined) item.name = String(body.name).trim().slice(0, 80);
            if (body.url !== undefined) item.url = body.url;
            if (body.enabled !== undefined) item.enabled = !!body.enabled;
            if (body.priority !== undefined) item.priority = Math.max(0, Math.min(100, Math.floor(Number(body.priority) || 0)));
            if (body.assignedUsername !== undefined) item.assignedUsername = body.assignedUsername || undefined;
            await env.kv.put(key(configId), JSON.stringify(item)); return json({ success: true, message: 'External config updated.', body: item });
        }
        if (request.method === 'DELETE') { await env.kv.delete(key(configId)); const ids: string[] = await env.kv.get(INDEX, { type: 'json' }) || []; await env.kv.put(INDEX, JSON.stringify(ids.filter(x => x !== configId))); return json({ success: true, message: 'External config deleted.' }); }
        if (request.method === 'POST' && parts[3] === 'check') {
            const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
            try { const r = await fetch(item.url, { method: 'GET', redirect: 'follow', signal: controller.signal }); const latency = Date.now() - started; item.lastCheckAt = new Date().toISOString(); item.lastLatencyMs = latency; item.lastStatus = r.status; item.lastError = undefined; await env.kv.put(key(configId), JSON.stringify(item)); return json({ success: r.ok, body: item }); }
            catch (e) { item.lastCheckAt = new Date().toISOString(); item.lastLatencyMs = Date.now() - started; item.lastError = String(e); await env.kv.put(key(configId), JSON.stringify(item)); return json({ success: false, message: 'Health check failed.', body: item }, 502); }
            finally { clearTimeout(timer); }
        }
        return json({ success: false, message: 'Method not allowed.' }, 405);
    } catch (e) { return json({ success: false, message: String(e instanceof Error ? e.message : e) }, 500); }
}

export async function handleExternalConfigSubscription(request: Request, env: Env): Promise<Response> {
    const id = new URL(request.url).pathname.split('/').filter(Boolean)[2];
    if (!id) return new Response('Not found', { status: 404 });
    const item = await env.kv.get(key(id), { type: 'json' }) as ExternalConfig | null;
    if (!item || !item.enabled) return new Response('Config unavailable.', { status: 404 });
    if (item.assignedUsername) { const user = await getUser(item.assignedUsername, env); if (!user || getStatus(user) !== 'active') return new Response('Subscription inactive or expired.', { status: 403 }); }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try { const upstream = await fetch(item.url, { redirect: 'follow', signal: controller.signal }); const headers = new Headers(upstream.headers); headers.set('cache-control', 'no-store'); headers.set('x-external-config', item.name); return new Response(upstream.body, { status: upstream.status, headers }); }
    catch { return new Response('Upstream config unavailable.', { status: 502 }); }
    finally { clearTimeout(timer); }
}

import { sha224 } from '@commercial/sha224';

export interface UserData {
    username: string;
    subPath: string;
    createdAt: string;
    expiresAt: string;
    note: string;
    active: boolean;
    vlessUUID: string;
    trojanPassword: string;
    maxConnections: number;
    quotaGb: number;
    quotaBytes: number;
}

function generateSubPath(): string { return crypto.randomUUID(); }
function generatePassword(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function createUser(username: string, days: number, note: string, env: Env, maxConnections = 1, quotaGb = 0): Promise<{ success: boolean; message: string; user?: UserData }> {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return { success: false, message: 'Invalid username. Use 3-20 alphanumeric characters or underscores.' };
    if (!Number.isFinite(days) || days <= 0 || days > 3650) return { success: false, message: 'Invalid subscription duration.' };
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 5) return { success: false, message: 'Connection limit must be between 1 and 5.' };
    if (!Number.isFinite(quotaGb) || quotaGb < 0 || quotaGb > 100000) return { success: false, message: 'Traffic quota must be between 0 and 100000 GB. Use 0 for unlimited.' };

    const index: string[] = await env.kv.get('users:index', { type: 'json' }) || [];
    if (index.includes(username)) return { success: false, message: 'Username already exists.' };

    const subPath = generateSubPath();
    const vlessUUID = crypto.randomUUID();
    const trojanPassword = generatePassword();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
    const normalizedQuotaGb = Math.round(quotaGb * 100) / 100;
    const quotaBytes = normalizedQuotaGb === 0 ? 0 : Math.floor(normalizedQuotaGb * 1024 * 1024 * 1024);
    const user: UserData = { username, subPath, createdAt: now.toISOString(), expiresAt, note: note || '', active: true, vlessUUID, trojanPassword, maxConnections, quotaGb: normalizedQuotaGb, quotaBytes };

    await env.kv.put(`user:${username}`, JSON.stringify(user));
    await env.kv.put(`user:vless:${vlessUUID}`, username);
    await env.kv.put(`user:trojan:${trojanPassword}`, username);
    await env.kv.put(`user:trojan-hash:${sha224(trojanPassword)}`, username);
    index.push(username);
    await env.kv.put('users:index', JSON.stringify(index));
    return { success: true, message: 'User created.', user };
}

export async function getUser(username: string, env: Env): Promise<UserData | null> { return await env.kv.get(`user:${username}`, { type: 'json' }); }

export async function listUsers(env: Env): Promise<UserData[]> {
    const index: string[] = await env.kv.get('users:index', { type: 'json' }) || [];
    if (index.length === 0) return [];
    const users = await Promise.all(index.map(u => getUser(u, env)));
    return users.filter((u): u is UserData => u !== null);
}

export async function updateUser(username: string, updates: Partial<{ days: number; note: string; active: boolean; maxConnections: number; quotaGb: number }>, env: Env): Promise<{ success: boolean; message: string; user?: UserData }> {
    const user = await getUser(username, env);
    if (!user) return { success: false, message: 'User not found.' };
    if (updates.days !== undefined) {
        if (!Number.isFinite(updates.days) || updates.days <= 0 || updates.days > 3650) return { success: false, message: 'Invalid subscription duration.' };
        const now = Date.now();
        const currentExp = new Date(user.expiresAt).getTime();
        user.expiresAt = new Date(Math.max(now, currentExp) + updates.days * 86400000).toISOString();
    }
    if (updates.note !== undefined) user.note = updates.note;
    if (updates.active !== undefined) user.active = updates.active;
    if (updates.maxConnections !== undefined) {
        if (!Number.isInteger(updates.maxConnections) || updates.maxConnections < 1 || updates.maxConnections > 5) return { success: false, message: 'Connection limit must be between 1 and 5.' };
        user.maxConnections = updates.maxConnections;
    }
    if (updates.quotaGb !== undefined) {
        if (!Number.isFinite(updates.quotaGb) || updates.quotaGb < 0 || updates.quotaGb > 100000) return { success: false, message: 'Traffic quota must be between 0 and 100000 GB. Use 0 for unlimited.' };
        user.quotaGb = Math.round(updates.quotaGb * 100) / 100;
        user.quotaBytes = user.quotaGb === 0 ? 0 : Math.floor(user.quotaGb * 1024 * 1024 * 1024);
    }
    await env.kv.put(`user:${username}`, JSON.stringify(user));
    return { success: true, message: 'User updated.', user };
}

export async function deleteUser(username: string, env: Env): Promise<{ success: boolean; message: string }> {
    const user = await getUser(username, env);
    if (!user) return { success: false, message: 'User not found.' };
    await Promise.all([
        env.kv.delete(`user:${username}`),
        env.kv.delete(`user:vless:${user.vlessUUID}`),
        env.kv.delete(`user:trojan:${user.trojanPassword}`),
        env.kv.delete(`user:trojan-hash:${sha224(user.trojanPassword)}`)
    ]);
    const index: string[] = await env.kv.get('users:index', { type: 'json' }) || [];
    await env.kv.put('users:index', JSON.stringify(index.filter(u => u !== username)));
    return { success: true, message: 'User deleted.' };
}

export async function findUserBySubPath(subPath: string, env: Env): Promise<UserData | null> {
    const index: string[] = await env.kv.get('users:index', { type: 'json' }) || [];
    for (const username of index) { const user = await getUser(username, env); if (user && user.subPath === subPath) return normalizeUser(user); }
    return null;
}
export async function findUserByVlessUUID(uuid: string, env: Env): Promise<UserData | null> { const username = await env.kv.get(`user:vless:${uuid}`); const user = username ? await getUser(username, env) : null; return user ? normalizeUser(user) : null; }
export async function findUserByTrojanPassword(passwordHash: string, env: Env): Promise<UserData | null> {
    const username = await env.kv.get(`user:trojan-hash:${passwordHash}`);
    if (username) { const user = await getUser(username, env); return user ? normalizeUser(user) : null; }
    const index: string[] = await env.kv.get('users:index', { type: 'json' }) || [];
    for (const name of index) {
        const user = await getUser(name, env);
        if (user && sha224(user.trojanPassword) === passwordHash) {
            await env.kv.put(`user:trojan-hash:${passwordHash}`, name);
            return normalizeUser(user);
        }
    }
    return null;
}

function normalizeUser(user: UserData): UserData {
    const legacy = user as UserData & { quotaGb?: number; quotaBytes?: number };
    if (typeof legacy.quotaGb !== 'number') legacy.quotaGb = 0;
    if (typeof legacy.quotaBytes !== 'number') legacy.quotaBytes = legacy.quotaGb === 0 ? 0 : Math.floor(legacy.quotaGb * 1024 * 1024 * 1024);
    if (!Number.isInteger(legacy.maxConnections) || legacy.maxConnections < 1) legacy.maxConnections = 1;
    if (legacy.maxConnections > 5) legacy.maxConnections = 5;
    return legacy;
}

export function getStatus(user: UserData): 'active' | 'expired' | 'disabled' { if (!user.active) return 'disabled'; if (new Date(user.expiresAt) < new Date()) return 'expired'; return 'active'; }

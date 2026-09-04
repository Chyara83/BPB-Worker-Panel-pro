import { Authenticate } from '@auth';
import { HttpStatus, respond, safeErrorMessage } from '@common';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '@users';
import { getUserUsage, resetUserUsage } from '@commercial/usage';

async function authorized(request: Request, env: Env): Promise<boolean> {
    const pwd = await env.kv.get('pwd');
    if (!pwd) return true;
    return await Authenticate(request, env);
}

function decorate(user: any, usage: any) {
    const quotaBytes = Number(user.quotaBytes || 0);
    const usedBytes = Number(usage?.usedBytes || 0);
    return {
        ...user,
        usedBytes,
        usedGb: usedBytes / 1073741824,
        remainingBytes: quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) : 0,
        remainingGb: quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) / 1073741824 : 0,
        activeSessions: Number(usage?.activeSessions || 0),
        maxConnections: Number(user.maxConnections || usage?.maxConnections || 1)
    };
}

export async function handleCommercialUsers(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env))) return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const username = parts.length >= 3 ? decodeURIComponent(parts[2]) : '';

    try {
        if (!username) {
            if (request.method === 'GET') {
                const users = await listUsers(env);
                const result = await Promise.all(users.map(async user => decorate(user, await getUserUsage(user, env))));
                return respond(true, HttpStatus.OK, '', result);
            }
            if (request.method === 'POST') {
                const body = await request.json<{ username?: string; days?: number; note?: string; maxConnections?: number; quotaGb?: number }>();
                const result = await createUser(body.username || '', Number(body.days ?? 30), body.note || '', env, Number(body.maxConnections ?? 1), Number(body.quotaGb ?? 0));
                if (!result.success) return respond(false, HttpStatus.BAD_REQUEST, result.message);
                if (result.user) await getUserUsage(result.user, env);
                return respond(true, HttpStatus.OK, result.message, result.user);
            }
            return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
        }

        const user = await getUser(username, env);
        if (!user) return respond(false, HttpStatus.NOT_FOUND, 'User not found.');

        if (request.method === 'GET') {
            const usage = await getUserUsage(user, env);
            return respond(true, HttpStatus.OK, '', decorate(user, usage));
        }

        if (request.method === 'PUT') {
            const body = await request.json<{ days?: number; note?: string; active?: boolean; maxConnections?: number; quotaGb?: number; resetUsage?: boolean }>();
            const result = await updateUser(username, {
                days: body.days,
                note: body.note,
                active: body.active,
                maxConnections: body.maxConnections,
                quotaGb: body.quotaGb
            }, env);
            if (!result.success || !result.user) return respond(false, HttpStatus.NOT_FOUND, result.message);
            if (body.resetUsage) await resetUserUsage(result.user, env);
            const usage = await getUserUsage(result.user, env);
            return respond(true, HttpStatus.OK, result.message, decorate(result.user, usage));
        }

        if (request.method === 'DELETE') {
            const result = await deleteUser(username, env);
            if (!result.success) return respond(false, HttpStatus.NOT_FOUND, result.message);
            return respond(true, HttpStatus.OK, result.message);
        }

        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error: ${safeErrorMessage(error)}`);
    }
}

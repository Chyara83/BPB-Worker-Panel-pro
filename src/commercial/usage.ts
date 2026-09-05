import type { UserData } from '@users';

const MB = 1024 * 1024;
export const USAGE_REPORT_BYTES = 256 * 1024;
function stubFor(user: UserData, env: Env) { return env.USER_USAGE.get(env.USER_USAGE.idFromName(user.username)); }
export async function acquireUserSession(user: UserData, env: Env) { return await stubFor(user, env).acquire(user.quotaBytes, user.maxConnections); }
export async function releaseUserSession(user: UserData, env: Env) { await stubFor(user, env).release(); }
export async function consumeUserBytes(user: UserData, env: Env, bytes: number) { return await stubFor(user, env).consume(bytes); }
export async function getUserUsage(user: UserData, env: Env) { return await stubFor(user, env).stats(user.quotaBytes, user.maxConnections); }
export async function resetUserUsage(user: UserData, env: Env) { await stubFor(user, env).resetUsage(); }
export async function resetUserState(user: UserData, env: Env) { await stubFor(user, env).resetState(); }
export function gbToBytes(gb: number): number { if (!Number.isFinite(gb) || gb <= 0) return 0; return Math.floor(gb * 1024 * MB); }
export function bytesToGb(bytes: number): number { return bytes / (1024 * MB); }

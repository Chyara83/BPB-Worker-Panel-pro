export interface UsageSnapshot {
    usedBytes: number;
    quotaBytes: number;
}

export function remainingBytes(snapshot: UsageSnapshot): number {
    if (snapshot.quotaBytes <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, snapshot.quotaBytes - snapshot.usedBytes);
}

export function quotaExceeded(snapshot: UsageSnapshot): boolean {
    return snapshot.quotaBytes > 0 && snapshot.usedBytes >= snapshot.quotaBytes;
}

export async function addUsage(env: Env, userId: string, bytesIn: number, bytesOut: number): Promise<void> {
    const safeIn = Math.max(0, Math.floor(bytesIn));
    const safeOut = Math.max(0, Math.floor(bytesOut));
    if (safeIn === 0 && safeOut === 0) return;

    const total = safeIn + safeOut;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);

    await env.DB.prepare(
        `UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?`
    ).bind(total, userId).run();

    await env.DB.prepare(
        `INSERT INTO usage_daily (user_id, day, bytes_in, bytes_out)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, day) DO UPDATE SET
           bytes_in = bytes_in + excluded.bytes_in,
           bytes_out = bytes_out + excluded.bytes_out`
    ).bind(userId, day, safeIn, safeOut).run();
}

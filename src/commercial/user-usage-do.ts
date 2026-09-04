import { DurableObject } from 'cloudflare:workers';

interface UsageState {
    quotaBytes: number;
    usedBytes: number;
    activeSessions: number;
    maxConnections: number;
}

export class UserUsageDO extends DurableObject<Env> {
    private initialized = false;

    private load(): UsageState {
        const row = this.ctx.storage.sql.exec(
            'SELECT quota_bytes as quotaBytes, used_bytes as usedBytes, active_sessions as activeSessions, max_connections as maxConnections FROM usage WHERE id = 1'
        ).toArray()[0] as unknown as UsageState | undefined;
        if (row) return row;
        const state: UsageState = { quotaBytes: 0, usedBytes: 0, activeSessions: 0, maxConnections: 1 };
        this.ctx.storage.sql.exec(
            'INSERT INTO usage (id, quota_bytes, used_bytes, active_sessions, max_connections) VALUES (1, ?, ?, ?, ?)',
            state.quotaBytes, state.usedBytes, state.activeSessions, state.maxConnections
        );
        return state;
    }

    private ensureSchema() {
        if (this.initialized) return;
        this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage (
            id INTEGER PRIMARY KEY,
            quota_bytes INTEGER NOT NULL DEFAULT 0,
            used_bytes INTEGER NOT NULL DEFAULT 0,
            active_sessions INTEGER NOT NULL DEFAULT 0,
            max_connections INTEGER NOT NULL DEFAULT 1
        )`);
        this.initialized = true;
    }

    async initialize(quotaBytes: number, maxConnections: number): Promise<void> {
        this.ensureSchema();
        this.load();
        const quota = Math.max(0, Math.floor(quotaBytes));
        const max = Math.min(5, Math.max(1, Math.floor(maxConnections)));
        this.ctx.storage.sql.exec('UPDATE usage SET quota_bytes = ?, max_connections = ? WHERE id = 1', quota, max);
    }

    async acquire(quotaBytes: number, maxConnections: number): Promise<{ ok: boolean; reason: 'ok' | 'quota' | 'limit'; usedBytes: number; quotaBytes: number; activeSessions: number }> {
        await this.initialize(quotaBytes, maxConnections);
        const state = this.load();
        if (state.quotaBytes > 0 && state.usedBytes >= state.quotaBytes) return { ok: false, reason: 'quota', ...state };
        if (state.activeSessions >= state.maxConnections) return { ok: false, reason: 'limit', ...state };
        this.ctx.storage.sql.exec('UPDATE usage SET active_sessions = active_sessions + 1 WHERE id = 1');
        const next = this.load();
        return { ok: true, reason: 'ok', ...next };
    }

    async release(): Promise<void> {
        this.ensureSchema();
        this.ctx.storage.sql.exec('UPDATE usage SET active_sessions = MAX(active_sessions - 1, 0) WHERE id = 1');
    }

    async consume(bytes: number): Promise<{ ok: boolean; accepted: number; usedBytes: number; quotaBytes: number }> {
        this.ensureSchema();
        const amount = Math.max(0, Math.floor(bytes));
        if (!amount) {
            const state = this.load();
            return { ok: true, accepted: 0, usedBytes: state.usedBytes, quotaBytes: state.quotaBytes };
        }
        const state = this.load();
        if (state.quotaBytes <= 0) {
            this.ctx.storage.sql.exec('UPDATE usage SET used_bytes = used_bytes + ? WHERE id = 1', amount);
            return { ok: true, accepted: amount, usedBytes: state.usedBytes + amount, quotaBytes: state.quotaBytes };
        }
        const remaining = Math.max(0, state.quotaBytes - state.usedBytes);
        const accepted = Math.min(amount, remaining);
        if (accepted > 0) this.ctx.storage.sql.exec('UPDATE usage SET used_bytes = used_bytes + ? WHERE id = 1', accepted);
        return { ok: accepted === amount, accepted, usedBytes: state.usedBytes + accepted, quotaBytes: state.quotaBytes };
    }

    async stats(quotaBytes?: number, maxConnections?: number): Promise<UsageState> {
        this.ensureSchema();
        if (quotaBytes !== undefined && maxConnections !== undefined) await this.initialize(quotaBytes, maxConnections);
        return this.load();
    }

    async resetUsage(): Promise<void> {
        this.ensureSchema();
        this.ctx.storage.sql.exec('UPDATE usage SET used_bytes = 0 WHERE id = 1');
    }
}

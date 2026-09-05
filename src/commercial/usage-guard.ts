import { acquireUserSession, consumeUserBytes, releaseUserSession } from '@commercial/usage';
import type { UserData } from '@users';

const REPORT_THRESHOLD = 64 * 1024;

export class UserUsageGuard {
    private acquired = false;
    private pendingBytes = 0;
    private closed = false;
    private chain: Promise<void> = Promise.resolve();

    constructor(private readonly user: UserData, private readonly env: Env, private readonly webSocket: WebSocket) {}

    async start(): Promise<void> {
        const result = await acquireUserSession(this.user, this.env);
        if (!result.ok) {
            const message = result.reason === 'limit' ? 'Maximum concurrent connections reached.' : 'Traffic quota exhausted.';
            try { this.webSocket.close(1008, message); } catch {}
            throw new Error(message);
        }
        this.acquired = true;
    }

    track(bytes: number): void {
        if (!this.acquired || this.closed || !Number.isFinite(bytes) || bytes <= 0) return;
        this.pendingBytes += Math.floor(bytes);
        if (this.pendingBytes >= REPORT_THRESHOLD) this.flush();
    }

    flush(): void {
        if (!this.acquired || this.pendingBytes <= 0) return;
        const bytes = this.pendingBytes;
        this.pendingBytes = 0;
        this.chain = this.chain.then(async () => {
            const result = await consumeUserBytes(this.user, this.env, bytes);
            if (!result.ok) {
                try { this.webSocket.close(1008, 'Traffic quota exhausted.'); } catch {}
            }
        }).catch(() => {
            try { this.webSocket.close(1011, 'Usage accounting unavailable.'); } catch {}
        });
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.flush();
        await this.chain;
        this.closed = true;
        if (this.acquired) {
            this.acquired = false;
            await releaseUserSession(this.user, this.env);
        }
    }
}

export function byteLength(value: unknown): number {
    if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return 0;
}

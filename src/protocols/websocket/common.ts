import { connect } from 'cloudflare:sockets';
import { isIPv4, parseHostPort, resolveDNS } from '@utils';
import { safeErrorMessage } from '@common';

export const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

export async function handleTCPOutBound(
    remoteSocket: { value: Socket | null },
    addressRemote: string,
    portRemote: number,
    rawClientData: ArrayBuffer | undefined,
    webSocket: WebSocket,
    VLResponseHeader: Uint8Array<ArrayBuffer> | null,
    log: Function
) {
    async function connectAndWrite(address: string, port: number): Promise<Socket> {
        log(`TCP connect attempt ${address}:${port}`);
        const tcpSocket = connect({ hostname: address, port });
        remoteSocket.value = tcpSocket;
        try {
            await tcpSocket.opened;
            log(`TCP socket opened ${address}:${port}`);
            const writer = tcpSocket.writable.getWriter();
            try {
                if (rawClientData && rawClientData.byteLength > 0) await writer.write(rawClientData);
            } finally {
                writer.releaseLock();
            }
            log(`TCP connected ${address}:${port}`);
            return tcpSocket;
        } catch (error) {
            safeCloseTcpSocket(tcpSocket);
            remoteSocket.value = null;
            throw error;
        }
    }

    async function retry() {
        const { proxyMode, panelIPs, envProxyIPs, defaultProxyIPs, envPrefixes, defaultPrefixes } = globalThis.wsConfig;
        const getRandomValue = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
        const parseIPs = (value: string) => value ? value.split(',').map(val => val.trim()).filter(Boolean) : undefined;

        if (proxyMode === 'proxyip') {
            log(`direct connection failed, trying Proxy IP for ${addressRemote}`);
            const proxyIPs = panelIPs?.length ? panelIPs : parseIPs(envProxyIPs) ?? defaultProxyIPs;
            if (!proxyIPs?.length) throw new Error('No Proxy IP available for retry');
            const proxyIP = getRandomValue(proxyIPs);
            const { host, port } = parseHostPort(proxyIP, true);
            addressRemote = host || addressRemote;
            portRemote = port || portRemote;
        } else if (proxyMode === 'prefix') {
            log(`direct connection failed, trying dynamic prefix for ${addressRemote}`);
            const prefixes = panelIPs?.length ? panelIPs : parseIPs(envPrefixes) ?? defaultPrefixes;
            if (!prefixes?.length) throw new Error('No prefix available for retry');
            const prefix = getRandomValue(prefixes);
            const dynamicProxyIP = await getDynamicProxyIP(addressRemote, prefix);
            if (!dynamicProxyIP) throw new Error('Retry connection failed: Invalid Prefix');
            addressRemote = dynamicProxyIP;
        }

        try {
            const tcpSocket = await connectAndWrite(addressRemote, portRemote);
            tcpSocket.closed
                .catch(error => console.log('retry TCP socket closed error', error))
                .finally(() => safeCloseWebSocket(webSocket));
            await remoteSocketToWS(tcpSocket, webSocket, VLResponseHeader, null, log);
        } catch (error) {
            console.error('Retry connection failed:', error);
            safeCloseWebSocket(webSocket);
            throw new Error(`Retry connection failed: ${safeErrorMessage(error)}`, { cause: error });
        }
    }

    try {
        const tcpSocket = await connectAndWrite(addressRemote, portRemote);
        await remoteSocketToWS(tcpSocket, webSocket, VLResponseHeader, retry, log);
    } catch (error) {
        console.error(`Connection failed: ${safeErrorMessage(error)}`);
        const { proxyMode } = globalThis.wsConfig;
        if (proxyMode === 'proxyip' || proxyMode === 'prefix') {
            await retry();
        } else {
            safeCloseWebSocket(webSocket);
            throw new Error(`Connection failed: ${safeErrorMessage(error)}`, { cause: error });
        }
    }
}

async function remoteSocketToWS(
    remoteSocket: Socket,
    webSocket: WebSocket,
    VLResponseHeader: Uint8Array<ArrayBuffer> | null,
    retry: Function | null,
    log: Function
) {
    let vlHeader = VLResponseHeader;
    let hasIncomingData = false;

    const writableStream = new WritableStream({
        start() { },
        async write(chunk, controller) {
            hasIncomingData = true;
            if (webSocket.readyState !== WS_READY_STATE_OPEN) {
                controller.error("webSocket.readyState is not open, maybe close");
            }
            if (vlHeader) {
                webSocket.send(await new Blob([vlHeader, chunk]).arrayBuffer());
                vlHeader = null;
            } else {
                webSocket.send(chunk);
            }
        },
        close() {
            log(`remoteConnection.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
            console.error(`remoteConnection.readable abort`, reason);
            safeCloseTcpSocket(remoteSocket);
        }
    });

    try {
        await remoteSocket.readable.pipeTo(writableStream);
    } catch (error) {
        console.error('VLRemoteSocketToWS has exception.', error);
        safeCloseTcpSocket(remoteSocket);
        safeCloseWebSocket(webSocket);
        throw error;
    }

    if (hasIncomingData === false && retry) {
        log(`retry`);
        await retry();
    }
}

export function makeReadableWebSocketStream(webSocketServer: WebSocket, earlyDataHeader: string, log: Function) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocketServer.addEventListener("message", (event) => {
                if (readableStreamCancel) return;
                controller.enqueue(event.data);
            });
            webSocketServer.addEventListener("close", () => {
                if (readableStreamCancel) return;
                controller.close();
                safeCloseWebSocket(webSocketServer);
            });
            webSocketServer.addEventListener("error", (err) => {
                log("webSocketServer has error");
                controller.error(err);
            });
            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },
        pull(_controller) { },
        cancel(reason) {
            if (readableStreamCancel) return;
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocketServer);
        }
    });
    return stream;
}

function base64ToArrayBuffer(base64Str: string) {
    if (!base64Str) return { earlyData: null, error: null };
    try {
        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        const decode = atob(base64Str);
        const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arryBuffer.buffer, error: null };
    } catch (error) {
        return { earlyData: null, error };
    }
}

export function safeCloseTcpSocket(socket: Socket | null) {
    if (socket) {
        try { socket.close(); } catch (error) { console.error("Failed to close TCP socket:", error); }
    }
}

export function safeCloseWebSocket(socket: WebSocket) {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) socket.close();
    } catch (error) { console.error('safeCloseWebSocket error', error); }
}

async function getDynamicProxyIP(address: string, prefix: string) {
    let finalAddress = address;
    if (!isIPv4(address)) {
        const { ipv4 } = await resolveDNS(address, true);
        if (ipv4.length) finalAddress = ipv4[0];
        else throw new Error('Unable to find IPv4 in DNS records');
    }
    return convertToNAT64IPv6(finalAddress, prefix);
}

function convertToNAT64IPv6(ipv4Address: string, prefix: string) {
    const parts = ipv4Address.split('.');
    if (parts.length !== 4) throw new Error('Invalid IPv4 address');
    const hex = parts.map(part => {
        const num = parseInt(part, 10);
        if (num < 0 || num > 255) throw new Error('Invalid IPv4 address');
        return num.toString(16).padStart(2, '0');
    });
    const match = prefix.match(/^\[([0-9A-Fa-f:]+)\]$/);
    if (match) return `[${match[1]}${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
    return undefined;
}

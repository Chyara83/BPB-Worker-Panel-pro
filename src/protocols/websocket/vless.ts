import { isValidUUID } from '@common';
import { findUserByVlessUUID, getStatus } from '@users';
import { UserUsageGuard, byteLength } from '@commercial/usage-guard';
import { safeCloseTcpSocket, handleTCPOutBound, makeReadableWebSocketStream, WS_READY_STATE_OPEN } from './common';

export async function VlOverWSHandler(request: Request, env: Env): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.binaryType = 'arraybuffer';
    webSocket.accept({ allowHalfOpen: true });
    let address = "";
    let portWithRandomLog = "";
    let usageGuard: UserUsageGuard | null = null;
    let stage = 'websocket_accepted';
    const log = (info: string, event?: string) => console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    console.log({ event: 'vless_stage', stage, earlyDataHeaderLength: earlyDataHeader.length });
    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);
    let remoteSocketWapper: { value: Socket | null } = { value: null };
    let udpStreamWrite: any = null;
    let isDns = false;
    let pendingVlessData: ArrayBuffer | null = null;
    const releaseUsage = () => { void usageGuard?.close(); };
    webSocket.addEventListener('close', releaseUsage);
    webSocket.addEventListener('error', releaseUsage);

    const writableStream = new WritableStream({
        async write(chunk) {
            stage = 'first_data_received';
            console.log({ event: 'vless_stage', stage, chunkBytes: byteLength(chunk), pendingBytes: pendingVlessData?.byteLength || 0 });
            if (usageGuard) usageGuard.track(byteLength(chunk));
            if (isDns && udpStreamWrite) return udpStreamWrite(chunk);
            if (remoteSocketWapper.value) {
                stage = 'existing_tcp_write';
                const writer = remoteSocketWapper.value.writable.getWriter();
                try { await writer.write(chunk); } finally { writer.releaseLock(); }
                return;
            }

            const currentData = toArrayBuffer(chunk);
            const requestData = pendingVlessData ? concatArrayBuffers(pendingVlessData, currentData) : currentData;
            pendingVlessData = requestData;

            try {
                stage = 'uuid_extract';
                if (requestData.byteLength < 17) {
                    console.log({ event: 'vless_stage', stage: 'waiting_for_uuid', bufferedBytes: requestData.byteLength });
                    return;
                }
                const uuidInfo = extractUUID(requestData);
                console.log({
                    event: 'vless_uuid_extract_result',
                    firstByte: uuidInfo.firstByte,
                    candidateUUIDFingerprint: uuidInfo.fingerprint,
                    candidateUUIDFormatValid: uuidInfo.formatValid,
                    uuidVersionNibble: uuidInfo.versionNibble,
                    uuidVariantNibble: uuidInfo.variantNibble,
                    bufferedBytes: requestData.byteLength,
                    extractionError: uuidInfo.error
                });
                if (!uuidInfo.uuid) {
                    console.error({
                        event: 'vless_uuid_extract_failed',
                        firstByte: uuidInfo.firstByte,
                        candidateUUIDFingerprint: uuidInfo.fingerprint,
                        candidateUUIDFormatValid: uuidInfo.formatValid,
                        uuidVersionNibble: uuidInfo.versionNibble,
                        uuidVariantNibble: uuidInfo.variantNibble,
                        bufferedBytes: requestData.byteLength,
                        extractionError: uuidInfo.error
                    });
                    throw new Error("invalid user");
                }
                const presentedUUID = uuidInfo.uuid;
                console.log({ event: 'vless_stage', stage: 'uuid_extracted' });
                stage = 'kv_user_lookup';
                const { userID } = globalThis.globalConfig;
                const user = await findUserByVlessUUID(presentedUUID, env);
                console.log({
                    event: 'vless_user_lookup',
                    found: !!user,
                    status: user ? getStatus(user) : 'none',
                    matchesPanelUUID: presentedUUID === userID,
                    presentedUUIDFingerprint: uuidFingerprint(presentedUUID),
                    panelUUIDFingerprint: userID ? uuidFingerprint(userID) : null
                });
                if (user) {
                    if (getStatus(user) !== 'active') throw new Error(`user ${getStatus(user)}`);
                    stage = 'usage_guard_start';
                    usageGuard = new UserUsageGuard(user, env, webSocket);
                    await usageGuard.start();
                    console.log({ event: 'vless_stage', stage: 'usage_guard_started', username: user.username });
                    const originalSend = webSocket.send.bind(webSocket);
                    webSocket.send = (data: any) => { usageGuard?.track(byteLength(data)); originalSend(data); };
                } else if (presentedUUID !== userID) throw new Error("invalid user");

                stage = 'vless_header_parse';
                const parsed = parseVlHeader(requestData, user?.vlessUUID || userID!);
                if (parsed.incomplete) {
                    console.log({ event: 'vless_stage', stage: 'waiting_for_header', bufferedBytes: requestData.byteLength });
                    return;
                }
                const { hasError, message, portRemote = 443, addressRemote = "", rawDataIndex, VLVersion = new Uint8Array([0, 0]), isUDP } = parsed;
                pendingVlessData = null;
                address = addressRemote;
                portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? "udp " : "tcp "} `;
                console.log({ event: 'vless_header_parsed', hasError, portRemote, isUDP: !!isUDP, addressPresent: !!addressRemote });
                if (hasError) throw new Error(message);
                const VLResponseHeader = new Uint8Array([VLVersion[0], 0]);
                const rawClientData = requestData.slice(rawDataIndex);
                if (isUDP) {
                    if (portRemote === 53) {
                        stage = 'dns_outbound';
                        isDns = true;
                        const { write } = await handleUDPOutBound(webSocket, VLResponseHeader, log);
                        udpStreamWrite = write;
                        await udpStreamWrite(rawClientData);
                        return;
                    }
                    throw new Error("UDP proxy only enable for DNS which is port 53");
                }
                stage = 'tcp_outbound';
                console.log({ event: 'vless_stage', stage });
                await handleTCPOutBound(remoteSocketWapper, addressRemote, portRemote, rawClientData, webSocket, VLResponseHeader, log);
            } catch (error) {
                console.error({ event: 'vless_write_failed', stage, message: String(error) });
                throw error;
            }
        },
        async close() { safeCloseTcpSocket(remoteSocketWapper.value); if (usageGuard) await usageGuard.close(); },
        abort(reason) { log(`readableWebSocketStream is abort`, JSON.stringify(reason)); void usageGuard?.close(); }
    });

    readableWebSocketStream.pipeTo(writableStream).catch(error => {
        console.error({ event: 'vless_pipe_failed', stage, message: String(error) });
        log("readableWebSocketStream pipeTo error", error);
        safeCloseTcpSocket(remoteSocketWapper.value);
        void usageGuard?.close();
    });
    return new Response(null, { status: 101, webSocket: client });
}

function toArrayBuffer(value: any): ArrayBuffer {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    throw new Error('invalid websocket binary data');
}

function concatArrayBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
    const result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(new Uint8Array(a), 0);
    result.set(new Uint8Array(b), a.byteLength);
    return result.buffer;
}

function extractUUID(VLBuffer: ArrayBuffer): {
    uuid: string | null;
    firstByte: number;
    fingerprint: string;
    formatValid: boolean;
    uuidVersionNibble: number | null;
    uuidVariantNibble: number | null;
    error: string | null;
} {
    const bytes = new Uint8Array(VLBuffer);
    const firstByte = bytes[0] ?? -1;
    if (bytes.byteLength < 17) {
        return { uuid: null, firstByte, fingerprint: '', formatValid: false, uuidVersionNibble: null, uuidVariantNibble: null, error: 'buffered data is shorter than 17 bytes' };
    }

    try {
        const candidate = unsafeStringify(bytes, 1);
        const formatValid = isValidUUID(candidate);
        const uuidVersionNibble = (bytes[7] ?? 0) >> 4;
        const uuidVariantNibble = (bytes[9] ?? 0) >> 4;
        const fingerprint = `${candidate.slice(0, 8)}…${candidate.slice(-4)}`;
        return {
            uuid: formatValid ? candidate : null,
            firstByte,
            fingerprint,
            formatValid,
            uuidVersionNibble,
            uuidVariantNibble,
            error: null
        };
    } catch (error) {
        return {
            uuid: null,
            firstByte,
            fingerprint: '',
            formatValid: false,
            uuidVersionNibble: null,
            uuidVariantNibble: null,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

function uuidFingerprint(uuid: string): string {
    return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
}

function parseVlHeader(VLBuffer: ArrayBuffer, userID: string) {
    if (VLBuffer.byteLength < 18) return { incomplete: true as const };
    const version = new Uint8Array(VLBuffer.slice(0, 1));
    const slicedBuffer = new Uint8Array(VLBuffer.slice(1, 17));
    const slicedBufferString = stringify(slicedBuffer);
    if (slicedBufferString !== userID) return { hasError: true, message: "invalid user", incomplete: false as const };

    const optLength = new Uint8Array(VLBuffer.slice(17, 18))[0];
    const commandIndex = 18 + optLength;
    if (VLBuffer.byteLength < commandIndex + 1) return { incomplete: true as const };
    const command = new Uint8Array(VLBuffer.slice(commandIndex, commandIndex + 1))[0];
    let isUDP = false;
    if (command === 1) {} else if (command === 2) isUDP = true; else return { hasError: true, message: `command ${command} is not supported, command 01-tcp,02-udp,03-mux`, incomplete: false as const };

    const portIndex = 19 + optLength;
    if (VLBuffer.byteLength < portIndex + 3) return { incomplete: true as const };
    const portRemote = new DataView(VLBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
    const addressIndex = portIndex + 2;
    const addressType = new Uint8Array(VLBuffer.slice(addressIndex, addressIndex + 1))[0];
    let addressLength = 0, addressValueIndex = addressIndex + 1, addressValue = "";
    switch (addressType) {
        case 1:
            addressLength = 4;
            if (VLBuffer.byteLength < addressValueIndex + addressLength) return { incomplete: true as const };
            addressValue = new Uint8Array(VLBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
            break;
        case 2:
            if (VLBuffer.byteLength < addressValueIndex + 1) return { incomplete: true as const };
            addressLength = new Uint8Array(VLBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            if (VLBuffer.byteLength < addressValueIndex + addressLength) return { incomplete: true as const };
            addressValue = new TextDecoder().decode(VLBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 3:
            addressLength = 16;
            if (VLBuffer.byteLength < addressValueIndex + addressLength) return { incomplete: true as const };
            const dataView = new DataView(VLBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16));
            addressValue = ipv6.join(":");
            break;
        default:
            return { hasError: true, message: `invalid addressType is ${addressType}`, incomplete: false as const };
    }
    if (!addressValue) return { hasError: true, message: `addressValue is empty, addressType is ${addressType}`, incomplete: false as const };
    return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: addressValueIndex + addressLength, VLVersion: version, isUDP, incomplete: false as const };
}

function unsafeStringify(arr: Uint8Array, offset = 0) {
    const byteToHex: string[] = [];
    for (let i = 0; i < 256; ++i) byteToHex.push((i + 256).toString(16).slice(1));
    return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + "-" + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + "-" + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

function stringify(arr: Uint8Array, offset = 0) {
    const uuid = unsafeStringify(arr, offset);
    if (!isValidUUID(uuid)) throw TypeError("Stringified UUID is invalid");
    return uuid;
}

async function handleUDPOutBound(webSocket: WebSocket, VLResponseHeader: Uint8Array<ArrayBuffer>, log: Function) {
    let isVLHeaderSent = false;
    const transformStream = new TransformStream({ transform(chunk, controller) { for (let index = 0; index < chunk.byteLength;) { const lengthBuffer = chunk.slice(index, index + 2); const udpPakcetLength = new DataView(lengthBuffer).getUint16(0); const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength)); index += 2 + udpPakcetLength; controller.enqueue(udpData); } } });
    transformStream.readable.pipeTo(new WritableStream({ async write(chunk) { const resp = await fetch("https://cloudflare-dns.com/dns-query", { method: "POST", headers: { "content-type": "application/dns-message" }, body: chunk }); const dnsQueryResult = await resp.arrayBuffer(); const udpSize = dnsQueryResult.byteLength; const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]); if (webSocket.readyState === WS_READY_STATE_OPEN) { log(`doh success and dns message length is ${udpSize}`); if (isVLHeaderSent) webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer()); else { webSocket.send(await new Blob([VLResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer()); isVLHeaderSent = true; } } } })).catch(error => log("dns udp has error" + error));
    const writer = transformStream.writable.getWriter();
    return { async write(chunk: ArrayBuffer) { await writer.write(chunk); } };
}

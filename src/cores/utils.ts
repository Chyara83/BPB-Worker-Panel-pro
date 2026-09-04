import { safeErrorMessage } from "@common";

export function isDomain(address: string): boolean { if (!address) return false; return /^(?!-)(?:[A-Za-z0-9-]{1,63}.)+[A-Za-z]{2,}$/.test(address); }
export async function resolveDNS(domain: string, onlyIPv4 = false): Promise<DnsResult> { const dohBaseURL = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}`; try { const ipv4 = await fetchDNSRecords(`${dohBaseURL}&type=A`, 1); const ipv6 = onlyIPv4 ? [] : await fetchDNSRecords(`${dohBaseURL}&type=AAAA`, 28); return { ipv4, ipv6 }; } catch (error) { throw new Error(`Error resolving DNS for ${domain}: ${safeErrorMessage(error)}`); } }
export async function fetchDNSRecords(url: string, recordType: number): Promise<string[]> { try { const response = await fetch(url, { headers: { accept: 'application/dns-json' } }); const data: any = await response.json(); if (!data.Answer) return []; return data.Answer.filter((record: any) => record.type === recordType).map((record: any) => record.data); } catch (error) { throw new Error(`Failed to fetch DNS records from ${url}: ${safeErrorMessage(error)}`); } }
export function getProtocols() { const { settings: { VLConfigs, TRConfigs }, dict: { _VL_, _TR_ } } = globalThis; return [].concatIf(VLConfigs, _VL_).concatIf(TRConfigs, _TR_); }
export async function getConfigAddresses(isFragment: boolean): Promise<string[]> { const { httpConfig: { hostName }, settings: { enableIPv6, customCdnAddrs, cleanIPs } } = globalThis; const { ipv4, ipv6 } = await resolveDNS(hostName, !enableIPv6); return [hostName, 'www.speedtest.net', ...ipv4, ...ipv6.map(ip => `[${ip}]`), ...cleanIPs].concatIf(!isFragment, customCdnAddrs); }
export function generateRemark(index: number, port: number, address: string, protocol: string, isFragment: boolean, isChain: boolean): string { const { settings: { cleanIPs, customCdnAddrs, upstreamParams: { upstreamServer } }, dict: { _VL_, _VL_CAP_, _TR_CAP_ } } = globalThis; const isCustomAddr = customCdnAddrs.includes(address); const configType = isCustomAddr ? ' C' : isFragment ? ' F' : ''; const chainSign = isChain ? '🔗 ' : ''; const protoSign = protocol === _VL_ ? _VL_CAP_ : _TR_CAP_; let addressType; cleanIPs.includes(address) ? addressType = 'Clean IP' : addressType = isDomain(address) ? 'Domain' : isIPv4(address) ? 'IPv4' : isIPv6(address) ? 'IPv6' : ''; return address === upstreamServer ? `${index} - ${chainSign}${protoSign}${configType} - Upstream Proxy` : `${index} - ${chainSign}${protoSign}${configType} - ${addressType} : ${port}`; }
export function randomUpperCase(str: string): string { let result = ''; for (let i = 0; i < str.length; i++) result += Math.random() < 0.5 ? str[i].toUpperCase() : str[i]; return result; }
export function getRandomString(lengthMin: number, lengthMax: number): string { let result = ''; const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; const length = Math.floor(Math.random() * (lengthMax - lengthMin + 1)) + lengthMin; for (let i = 0; i < length; i++) result += charSet.charAt(Math.floor(Math.random() * charSet.length)); return result; }

export function generateWsPath(protocol: string): string {
    const { settings: { proxyIPMode, proxyIPs, prefixes }, globalConfig: { userID, TrPass }, dict: { _VL_ } } = globalThis;
    const config = {
        junk: getRandomString(8, 16),
        protocol: protocol === _VL_ ? "vl" : "tr",
        mode: proxyIPMode,
        panelIPs: proxyIPMode === 'proxyip' ? proxyIPs : prefixes,
        credential: protocol === _VL_ ? userID : TrPass
    };
    return `/${btoa(JSON.stringify(config))}`;
}

export function base64ToDecimal(base64: string): number[] { const binaryString = atob(base64); const hexString = Array.from(binaryString).map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join(''); return hexString.match(/.{2}/g)!.map(hex => parseInt(hex, 16)); }
export function isIPv4(address: string): boolean { return /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/([0-9]|[1-2][0-9]|3[0-2]))?$/.test(address); }
export function isIPv6(address: string): boolean { return /^\[(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|::(?:[a-fA-F0-9]{1,4}:){0,7}|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6})\](?:\/(1[0-1][0-9]|12[0-8]|[0-9]?[0-9]))?$/.test(address); }
export function getDomain(url: string) { try { const newUrl = new URL(url); return { host: newUrl.hostname, isHostDomain: isDomain(newUrl.hostname) }; } catch { return { host: '', isHostDomain: false }; } }
export function selectSniHost(address: string) { const { httpConfig: { hostName }, settings: { customCdnAddrs, customCdnHost, customCdnSni } } = globalThis; const isCustomAddr = customCdnAddrs.includes(address); return { host: isCustomAddr ? customCdnHost : hostName, sni: isCustomAddr ? customCdnSni : randomUpperCase(hostName), allowInsecure: isCustomAddr }; }
export function parseHostPort(input: string, brackets?: boolean): { host: string, port: number } { const regex = /^(?:\[(?<ipv6>.+?)\]|(?<host>[^:]+))(:(?<port>\d+))?$/; const match = input.match(regex); if (!match || !match.groups) return { host: "", port: 0 }; const { ipv6, host: plainHost, port: portStr } = match.groups; let host = ipv6 ?? plainHost ?? ""; if (brackets && ipv6) host = `[${ipv6}]`; return { host, port: portStr ? Number(portStr) : 0 }; }
export function isHttps(port: number): boolean { return globalThis.httpConfig.defaultHttpsPorts.includes(port); }
const isBypass = (type: string) => type === "direct"; const isBlock = (type: string) => type === "block";
export function accRoutingRules(geoAssets: GeoAsset[]) { const { customBypassRules, customBypassSanctionRules, customBlockRules } = globalThis.settings; return { bypass: { geosites: geoAssets }, customBypassRules, customBypassSanctionRules, customBlockRules, isBypass, isBlock }; }

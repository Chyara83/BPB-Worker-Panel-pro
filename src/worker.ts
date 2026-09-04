import { init, initHttp, initWs } from '@init';
import { fallback, serveIcon, renderSecrets, handlePanel, handleSubscriptions, handleLogin, logout, renderError, handleDoH, handleProxyIPs } from '@handlers';
import { handleCommercialWebsocket } from '@common/commercial-websocket';
import { handleCommercialUserSub } from '@common/commercial-subscription';
import { handleCommercialUsers } from '@common/commercial-users';
import { handleTelegramWebhook } from '@telegram';
export { UserUsageDO } from '@commercial/user-usage-do';

export default {
	async fetch(request: Request, env: Env) {
		try {
			const upgradeHeader = request.headers.get('Upgrade');
			init(request, env);
			if (upgradeHeader === 'websocket') {
				initWs(env);
				return await handleCommercialWebsocket(request, env);
			}
			const pathName = new URL(request.url).pathname;
			const path = pathName.split('/')[1];
			if (path === 'telegram') return await handleTelegramWebhook(request, env);
			initHttp(request, env);
			if (pathName === '/panel/users' || pathName.startsWith('/panel/users/')) return await handleCommercialUsers(request, env);
			switch (path) {
				case 'panel': return await handlePanel(request, env);
				case 'sub':
					if (pathName.startsWith('/sub/user/')) return await handleCommercialUserSub(request, env);
					return await handleSubscriptions(request, env);
				case 'login': return await handleLogin(request, env);
				case 'logout': return logout();
				case 'secrets': return await renderSecrets();
				case 'favicon.ico': return await serveIcon();
				case 'dns-query': return await handleDoH(request);
				case 'proxy-ip': return await handleProxyIPs(request, env);
				default: return await fallback(request);
			}
		} catch (error) { return await renderError(error); }
	}
};

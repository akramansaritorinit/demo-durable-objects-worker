export { Store } from './store'
interface Env {
	store: DurableObjectNamespace;
}

export default {
	async fetch(request: Request, env: Env) {
		try {
			const ip = request.headers.get('cf-connecting-ip');
			console.log(ip);
			const id = env.store.idFromName(ip!);
			const obj = env.store.get(id);
			return await obj.fetch(request);
		} catch (e) {
			console.error(e);
		}
	},
};

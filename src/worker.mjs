import HomePage from './page/home.html';
import UserPage from './page/user.html';

export default {
	async fetch(request, env) {
		let url = new URL(request.url);
		let path = url.pathname.slice(1).split('/');

		if (!path[0]) {
			return new Response(HomePage, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
		} else if (path.length === 1) {
			return new Response(UserPage, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
		} else {
			let userId = path[0];
			let objectId = env.store.idFromName(userId);
			let storeObject = env.store.get(objectId);
			return await storeObject.fetch(request);
		}
	},
};

export class Store {
	constructor(controller, env) {
		this.storage = controller.storage;
		this.env = env;
		this.sessions = [];
		this.lastTimestamp = 0;
	}

	async broadcast(data) {
		this.sessions.forEach((socket) => {
			socket.send(JSON.stringify(data));
		});
	}

	async fetch(request) {
		let url = new URL(request.url);
		let store = (await this.storage.get('store')) || { count: 0 };
		store = {
			...store,
			name: store.name ? store.name : 'Not set',
			count: store.count ? store.count : 0,
		};
		const path = url.pathname.slice(1).split('/');
		if (path[0] && path[1] === 'websocket') {
			console.log('websocket');
			if (request.headers.get('Upgrade') != 'websocket') {
				return new Response('expected websocket', { status: 400 });
			}
			let pair = new WebSocketPair();

			pair[1].accept();

			// Add the new socket to our list of sessions.
			this.sessions.push(pair[1]);

			// Send the current store to the new socket.
			pair[1].send(JSON.stringify({ type: 'update/store', store }));

			pair[1].addEventListener('message', (event) => {
				let data = JSON.parse(event.data);
				switch (data.type) {
					case 'setName':
						store = {
							...store,
							name: data.name,
						};
						this.storage.put('store', store);
						this.broadcast({ type: 'update/store', store });
						break;
					case 'increment':
						store = {
							...store,
							count: store.count + 1,
						};
						this.storage.put('store', store);
						this.broadcast({ type: 'update/store', store });
						break;
					case 'decrement':
						store = {
							...store,
							count: store.count - 1,
						};
						this.storage.put('store', store);
						this.broadcast({ type: 'update/store', store });
						break;
					default:
						break;
				}
			});

			return new Response(null, { status: 101, webSocket: pair[0] });
		} else {
			return new Response('Not found', { status: 404 });
		}
	}
}

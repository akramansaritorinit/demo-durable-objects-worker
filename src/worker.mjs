import HomePage from './pages/home.html';
import UserPage from './pages/user.html';

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
				let action = JSON.parse(event.data);
				let data = {};
				switch (action.type) {
					case 'setName':
						store = {
							...store,
							name: action.name,
						};
						data = {
							type: 'update/store',
							store,
						};
						this.storage.put('store', store);
						break;
					case 'increment':
						store = {
							...store,
							count: store.count + 1,
						};
						data = {
							type: 'update/store',
							store,
						};
						this.storage.put('store', store);
						break;
					case 'decrement':
						store = {
							...store,
							count: store.count - 1,
						};
						data = {
							type: 'update/store',
							store,
						};
						this.storage.put('store', store);
						break;
					case 'toggle-theme':
						data = {
							type: 'load/script',
							script: `
								let body = document.querySelector('body');
								if (body.classList.contains('dark')) {
									body.classList.remove('dark');
								} else {
									body.classList.add('dark');
								}
							`
						};
						break;
					case 'change-style':
						data = {
							type: 'load/style',
							style:`
								button {
									background: linear-gradient(to right, pink, orange);
									color: black;
									shadow: 0 0 10px black;
									transition: transform 0.5s;
								}
								button:hover {
									color: white;
									transform: scale(1.05);
								}
								body{
									font-family: 'Courier New', Courier, monospace;
									font-weight: bold;
								}
							`
						};
						break;
					default:
						break;
				}
				this.broadcast(data);
			});

			return new Response(null, { status: 101, webSocket: pair[0] });
		} else {
			return new Response('Not found', { status: 404 });
		}
	}
}

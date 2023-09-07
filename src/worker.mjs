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
					case 'toggle-theme':
						let script = `
							// Add the styles for the dark-mode theme
							let styleTag = document.createElement('style');
							styleTag.textContent = \`
								body.dark-mode {
									background-color: black;
									color: white;
								}
							\`; 
							document.head.appendChild(styleTag);
					
							// Toggle the dark-mode class on the body
							if (document.body.classList.contains('dark-mode')) {
								document.body.classList.remove('dark-mode');
							} else {
								document.body.classList.add('dark-mode');
							}
						`;
						this.broadcast({ type: 'load/script', script });
						break;
					case 'change-style':
						let style = `
							button {
								background: linear-gradient(to right, pink, orange);
								color: black;
								shadow: 0 0 10px black;
								transition: transform 0.5s;
							}
							button:hover {
								color: white;
								transform: scale(1.1);
							}
							body{
								font-family: 'Courier New', Courier, monospace;
								font-weight: bold;
							}
						`;
						this.broadcast({ type: 'load/style', style });
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

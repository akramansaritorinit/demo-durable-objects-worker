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

	async getStore() {
		let store = (await this.storage.get('store')) || { count: 0 };
		store = {
			...store,
			name: store.name ? store.name : 'Not set',
			count: store.count ? store.count : 0,
		};
		return store;
	}

	async fetch(request) {
		let url = new URL(request.url);
		let store = await this.getStore();
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
				let data = { type: 'update/store', store };
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
							`,
						};
						break;
					case 'change-style':
						data = {
							type: 'load/style',
							style: `
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
							`,
						};
						break;
					case 'load-images':
						data = {
							type: 'load/script',
							script: `
								let imageContainer = document.createElement('div');
								imageContainer.style.display = 'flex';
								imageContainer.style.flexWrap = 'wrap';
								imageContainer.style.justifyContent = 'space-evenly';
								imageContainer.style.alignItems = 'center';
								imageContainer.style.gap = '20px';
								imageContainer.style.margin = '64px 0';

								let imgStyle = \`
									max-width: 400px;
									aspect-ratio: 4/3;
									object-fit: cover;
									flex: 1;
									border-radius: 10px;
								\`;

								
								let img1 = document.createElement('img');
								img1.src = 'https://images.unsplash.com/photo-1693462135458-22f289177360?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2340&q=80';
								img1.setAttribute('loading', 'lazy');
								img1.style.cssText = imgStyle;

								
								let img2 = document.createElement('img');
								img2.src = 'https://images.unsplash.com/photo-1693253024090-1fc1e1821a5c?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2531&q=80';
								img2.setAttribute('loading', 'lazy');
								img2.style.cssText = imgStyle;

								
								let img3 = document.createElement('img');
								img3.src = 'https://images.unsplash.com/photo-1693225822978-dace07f3b31b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2342&q=80';
								img3.setAttribute('loading', 'lazy');
								img3.style.cssText = imgStyle;

								imageContainer.appendChild(img1);
								imageContainer.appendChild(img2);
								imageContainer.appendChild(img3);

								// Append the image container to the body
								document.body.appendChild(imageContainer);
							`,
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

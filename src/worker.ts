interface Env {
	counter: DurableObjectNamespace;
}

type Store = {
	count: number;
	name?: string;
};

export class Counter {
	state: DurableObjectState;
	private conns = new Set<WebSocket>();
	constructor(state: DurableObjectState) {
		this.state = state;
	}

	private broadcast(message: string) {
		for (const conn of this.conns) {
			// Check if the connection is still alive
			try {
				conn.send(message);
			} catch {
				// If the connection is closed, remove it from the Set
				this.conns.delete(conn);
			}
		}
	}

	private async getStore(): Promise<Store> {
		const store: Store | undefined = await this.state.storage.get('store');
		return store || { count: 0 };
	}
	
	  private async updateStore(newStore: Store) {
		await this.state.storage.put('store', newStore);
	  }

	async increment() {
		const store = await this.getStore();
		const newStore = { ...store, count: store.count + 1 };
		await this.updateStore(newStore);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/count', store: newStore }));

		return newStore;
	}

	async decrement() {
		const store = await this.getStore();
		const newStore = { ...store, count: store.count - 1 };
		await this.updateStore(newStore);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/count', store: newStore }));

		return newStore;
	}

	// Handle HTTP requests from clients.
	async fetch(request: Request) {
		// Apply requested action.
		let url = new URL(request.url);
		let store = await this.getStore();
		switch (url.pathname) {
			case '/':
				// Just serve the current value. No storage calls needed!
				break;
			case '/websocket':
				const [client, server] = Object.values(new WebSocketPair());

				server.addEventListener('message', async (event) => {
					// Messages are received/sent as strings, so we need to parse it into JSON
					// to use it as an object
					const action = JSON.parse(event.data as string);

					switch (action.type) {
						case 'increment':
							store = await this.increment();
							break;
						case 'decrement':
							store = await this.decrement();
							break;
					}

					// Send the updated store to the client
					server.send(JSON.stringify({ type: 'update/count', store }));
				});

				server.addEventListener('close', async () => {
					// Remove the session from the Set
					this.conns.delete(server);

					if (this.conns.size === 0) {
						// When the client disconnects, we can delete all the data in Durable Object
						// Deleting all data automatically discards the Durable Object instance
						await this.state.storage.deleteAll();
					}
				});

				server.accept();

				// Add the session to the Set
				this.conns.add(server);

				return new Response(null, {
					status: 101,
					webSocket: client,
				});
			default:
				return new Response('Not found', { status: 404 });
		}
		await this.state.storage.put('store', store);

		return new Response(JSON.stringify(store));
	}
}

async function handleRequest(request: Request, env: Env) {
	const pathname = new URL(request.url).pathname;
	if (pathname === '/') {
		let id = env.counter.idFromName('A');
		let obj = env.counter.get(id);
		let resp = await obj.fetch(request.url);
		let store: Store = await resp.json();
		console.log(store);
		//return html and connect to socket
		return new Response(
			`
			<html>
				<head>
					<title>Counter</title>
				</head>
				<body>
					<h1>Counter</h1>
					<p>Count: <span id="count">${store.count}</span></p>
					<button id="increment">Increment</button>
					<button id="decrement">Decrement</button>
					<script>
						const socket = new WebSocket('ws://127.0.0.1:8787/websocket');
						socket.addEventListener('message', (event) => {
							const action = JSON.parse(event.data);
							if (action.type === 'update/count') {
								document.getElementById('count').innerText = action.store.count;
							}
						});
						document.getElementById('increment').addEventListener('click', () => {
							socket.send(JSON.stringify({ type: 'increment' }));
						});
						document.getElementById('decrement').addEventListener('click', () => {
							socket.send(JSON.stringify({ type: 'decrement' }));
						});
					</script>
				</body>
			</html>
			`,
			{
				headers: {
					'content-type': 'text/html;charset=UTF-8',
				},
			}
		);
	}

	if (pathname === '/websocket') {
		const upgradeHeader = request.headers.get('Upgrade');

		// If the upgrade header is not set, or it's not set to "websocket", return 426
		if (!upgradeHeader || upgradeHeader !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		// Since we want all clients to connect to the same Durable Object instance, we'll use static string
		// instead of the client IP
		const counterId = env.counter.idFromName('A');
		const counter = env.counter.get(counterId);
		return await counter.fetch(request);
	}
}

export default {
	async fetch(request: Request, env: Env) {
		return await handleRequest(request, env);
	},
};

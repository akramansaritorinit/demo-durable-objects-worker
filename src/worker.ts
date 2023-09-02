interface Env {
	counter: DurableObjectNamespace;
}

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

	async increment() {
		const count: number = (await this.state.storage.get('count')) ?? 0;
		const newCount = count + 1;
		await this.state.storage.put('count', newCount);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/count', count: newCount }));

		return newCount;
	}

	async decrement() {
		const count: number = (await this.state.storage.get('count')) ?? 0;
		const newCount = count - 1;
		await this.state.storage.put('count', newCount);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/count', count: newCount }));

		return newCount;
	}

	// Handle HTTP requests from clients.
	async fetch(request: Request) {
		// Apply requested action.
		let url = new URL(request.url);
		let count: number = (await this.state.storage?.get('count')) || 0;
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

					if (action.type === 'increment') {
						const newCount = await this.increment();
						server.send(JSON.stringify({ type: 'update/count', count: newCount }));
					} else if (action.type === 'decrement') {
						const newCount = await this.decrement();

						server.send(JSON.stringify({ type: 'update/count', count: newCount }));
					}
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
		await this.state.storage?.put('count', count);

		return new Response(count.toString());
	}
}

async function handleRequest(request: Request, env: Env) {
	const pathname = new URL(request.url).pathname;
	if (pathname === '/') {
		let id = env.counter.idFromName('A');
		let obj = env.counter.get(id);
		let resp = await obj.fetch(request.url);
		let count = await resp.text();
		//return html and connect to socket
		return new Response(
			`
			<html>
				<head>
					<title>Counter</title>
				</head>
				<body>
					<h1>Counter</h1>
					<p>Count: <span id="count">${count}</span></p>
					<button id="increment">Increment</button>
					<button id="decrement">Decrement</button>
					<script>
						const socket = new WebSocket('ws://127.0.0.1:8787/websocket');
						socket.addEventListener('message', event => {
							const data = JSON.parse(event.data);
							if (data.type === 'update/count') {
								document.getElementById('count').innerText = data.count;
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
	fetch: handleRequest,
};

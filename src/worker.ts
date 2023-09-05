interface Env {
	store: DurableObjectNamespace;
}

export default {
	async fetch(request: Request, env: Env) {
		try {
			// get id dynamically from search params
			const url = new URL(request.url);
			const searchId = url.searchParams.get('id');
			if (!searchId) {
				return new Response('Select a Durable Object to contact by using' + ' the `id` URL query string parameter. e.g. ?id=1234', { status: 400 });
			}
			const id = env.store.idFromName(searchId);
			const obj = env.store.get(id);
			return await obj.fetch(request);
		} catch (e) {
			console.error(e);
		}
	},
};

type StoreType = {
	count: number;
	name?: string;
};
export class Store {
	state: DurableObjectState;
	private conns = new Set<WebSocket>();
	private store: StoreType = { count: 0 };

	constructor(state: DurableObjectState) {
		this.state = state;
		this.state.blockConcurrencyWhile(async () => {
			const store = await this.state.storage.get<StoreType>('store');
			this.store = store || { count: 0 };
		});
	}
	
	private async broadcast(message: string) {
		for (const conn of this.conns) {
			// Check if the connection is still alive
			try {
				conn.send(message);
			} catch (e) {
				// If the connection is closed, remove it from the Set
				this.conns.delete(conn);
			}
		}
	}

	private async updateStore(newStore: StoreType) {
		try {
			await this.state.storage.put('store', newStore);
		} catch (error) {
			console.error('Error updating store:', error);
		}
	}

	async increment() {
		const store = this.store;
		const newStore = { ...store, count: store.count + 1 };
		await this.updateStore(newStore);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/store', store: newStore }));

		this.store = newStore;

		return newStore;
	}

	async decrement() {
		const store = this.store;
		const newStore = { ...store, count: store.count - 1 };
		await this.updateStore(newStore);

		// Broadcast the new count to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/store', store: newStore }));

		this.store = newStore;

		return newStore;
	}

	async setName(name: string) {
		const store = this.store;
		const newStore = { ...store, name };
		await this.updateStore(newStore);

		// Broadcast the new name to all connected clients
		this.broadcast(JSON.stringify({ type: 'update/store', store: newStore }));

		this.store = newStore;

		return newStore;
	}

	// Handle HTTP requests from clients.
	async fetch(request: Request) {
		// Apply requested action.
		let store = this.store;
		const url = new URL(request.url);
		const pathname = url.pathname;
		if (pathname === '/') {
			return new Response(
				`
                <html>
                    <head>
                        <title>Home</title>
                        <style>
                            body {
                                font-family: sans-serif;
                            }
                            input {
                                margin-right: 10px;
                                padding: 10px 20px;
                                border-radius: 5px;
                                border: 1px solid #ccc;
                            }
    
                            button {
                                margin-right: 10px;
                                background: #eee;
                                border: 1px solid #ccc;
                                padding: 10px 20px;
                                border-radius: 5px;
                            }
    
                            hr {
                                margin: 20px 0;
                            }
                        </style>
    
                    </head>
                    <body>
                        <h1>Counter</h1>
                        <p>Name: <span id="name">${store.name || 'Not set'}</span></p>
                        <div>
                            <input id="name-input" type="text" placeholder="Enter your name" />
                            <button id="set-name">Set name</button>
                        </div>
                        <hr />
                        <p>Count: <span id="count">${store.count}</span></p>
                        <button id="increment">Increment</button>
                        <button id="decrement">Decrement</button>
                        
                        <script>
							const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                            const socket = new WebSocket(protocol + '//' + location.host + '/websocket' + location.search);
                            socket.addEventListener('message', (event) => {
                                const action = JSON.parse(event.data);
                                if (action.type === 'update/store') {
                                    document.getElementById('count').innerText = action.store.count;
                                    document.getElementById('name').innerText = action.store.name || 'Not set';
                                }
                            });
                            document.getElementById('increment').addEventListener('click', () => {
                                socket.send(JSON.stringify({ type: 'increment' }));
                            });
                            document.getElementById('decrement').addEventListener('click', () => {
                                socket.send(JSON.stringify({ type: 'decrement' }));
                            });
                            document.getElementById('set-name').addEventListener('click', () => {
                                const name = document.getElementById('name-input').value;
                                socket.send(JSON.stringify({ type: 'setName', name }));
                            });
                        </script>
                    </body>
                </html>
                `,
				{
					headers: {
						'Content-Type': 'text/html;charset=UTF-8',
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
			const [client, server] = Object.values(new WebSocketPair());

			server.addEventListener('message', (event) => {
				const action = JSON.parse(event.data as string);

				(async () => {
					switch (action.type) {
						case 'increment':
							store = await this.increment();
							break;
						case 'decrement':
							store = await this.decrement();
							break;
						case 'setName':
							store = await this.setName(action.name);
							break;
					}

					// Send the updated store to the client
					server.send(JSON.stringify({ type: 'update/store', store }));
				})().catch((error) => {
					console.error('Error in event handler:', error);
				});
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
		}
		return new Response('Not found', { status: 404 });
	}
}

import Executor from "../common/executor.js"
import State from "../common/state.js"
import Shipping from "../common/shipping.js"
import type { Ship } from "../common/shipping.js"
import type { ExecutorFunction } from "../common/executor.js"
import type { ExecutionResult } from "../common/types.js"

delete (window as any).fetch;
delete (window as any).XMLHttpRequest;
delete (window as any).WebSocket;
delete (window as any).EventSource;
delete (window as any).Worker;
delete (window as any).SharedWorker;
delete (window as any).ServiceWorker;
delete (window as any).BroadcastChannel;
delete (window as any).MessageChannel;
delete (window as any).Notification;
delete (window as any).indexedDB;
delete (window as any).localStorage;
delete (window as any).sessionStorage;
delete (window as any).open;
delete (window as any).alert;
delete (window as any).confirm;
delete (window as any).prompt;

interface ExecutionWaiter {
	timeout?: ReturnType<typeof setTimeout>;
	startTime: number;
	resolve: (result: ExecutionResult) => void;
}

class LagoonWorker {
	private executor!: Executor;

	private pending: Record<string, ExecutionWaiter> = {};

	constructor () {
		window.addEventListener("message", this.handleMessage.bind(this));
	}

	send (command: string, data: any, timeout?: number): Promise<ExecutionResult> {
		return new Promise((resolve, reject) => {
			window.parent.postMessage({
				token: (window as any).__LAGOON_TOKEN__,
				command: command,
				data: data
			});

			if (data && data.__reqId) {
				this.pending[data.__reqId] = {
					startTime: Date.now(),
					resolve: resolve
				};

				if (timeout) {
					this.pending[data.__reqId].timeout = setTimeout(() => {
						delete this.pending[data.__reqId];

						resolve({
							error: true,
							details: "Timed out"
						});
					}, timeout);
				}
			} else {
				resolve({ error: false });
			}
		});
	}

	response (command: string, data: any) {
		window.parent.postMessage({
			token: (window as any).__LAGOON_TOKEN__,
			command: command,
			data: data
		});
	}

	compile (name: string, code: string): ExecutorFunction {
		const wrappedCode = `
			"use strict";

			return (async (args) => {
				"use strict";

				${code}
			});
			//# sourceURL=lagoon:${name}
		`;

		const factory = new Function(wrappedCode);
		const fn = factory();

		if (typeof fn !== "function") {
			throw new Error(`Script "${name}" did not compile to a function`);
		}

		return async (args: Record<string, any>) => {
			await Promise.resolve(fn(args));
		};
	}

	async handleMessage (ev: MessageEvent) {
		const data = ev.data;

		if (data.token !== (window as any).__LAGOON_TOKEN__) return;

		if (data.command === "ping") {
			this.response("pong", null);
		} else{
			switch (data.command) {
				case "setup":
					this.setup(data.data);
					break;
				case "sync":
					this.sync(data.data);
					break;
				case "ship":
					this.shipReceived(data.data);
					break;
				case "shipResponse":
					this.shipResponse(data.data)
					break;
				case "registerFunction":
					this.registerFunction(data.data);
					break;
				case "execute":
					this.execute(data.data);
					break;
				case "run":
					this.run(data.data);
					break;
				case "runMany":
					this.runMany(data.data);
					break;
				default:
					console.error(`Worker error: Unknown command: ${data.command}`);
					break;
			}
		}
	}

	async setup (data: { __reqId: string; state: any }) {
		try {
			if (this.executor) throw new Error(`Worker already initialized`);

			this.executor = new Executor(
				State.build(data.state),
				new Shipping(crypto.randomUUID, this.send.bind(this))
			);

			this.response("result", {
				__reqId: data.__reqId,
				error: false
			});
		} catch (err: any) {
			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}

	async sync (data: { __reqId: string; diff: Record<string, any>; }) {
		try {
			this.executor.state.applyDiff(data.diff);

			this.response("result", {
				__reqId: data.__reqId,
				error: false
			});
		} catch (err: any) {
			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}

	async shipReceived (data: { __reqId: string; data: Ship; }) {
		try {
			const ship = await this.executor.shipping.handleShip(data.data);

			this.response("shipResponse", { __reqId: data.__reqId, error: false, data: ship });
		} catch (err: any) {
			this.response("shipResponse", { __reqId: data.__reqId, error: true, details: err.toString() });
		}
	}

	shipResponse (data: { __reqId: string; error: boolean; details?: string; data?: Ship; }) {
		const pending = this.pending[data.__reqId];

		if (pending) {
			clearTimeout(pending.timeout);

			pending.resolve({
				error: data.error,
				details: data.details,
				data: data.data
			});
		}
	}

	registerFunction (data: { __reqId: string; name: string; code: string; }) {
		try {
			const fn = this.compile(data.name, data.code);

			this.executor.registerFunction(data.name, fn);

			this.response("result", {
				__reqId: data.__reqId,
				error: false
			});;
		} catch (err: any) {
			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}

	async execute (data: { __reqId: string; code: string; args: Record<string, any>; diff: any; }) {
		try {
			this.executor.applyDiff(data.diff);
			
			const fn = this.compile("generic", data.code);

			await this.executor.execute(fn, data.args);

			this.response("result", {
				__reqId: data.__reqId,
				error: false,
				diff: this.executor.state.commit()
			});;
		} catch (err: any) {
			this.executor.state.reset();

			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}

	async run (data: { __reqId: string; name: string; args: Record<string, any>; diff: any }) {
		try {
			this.executor.applyDiff(data.diff);

			await this.executor.run(data.name, data.args);

			this.response("result", {
				__reqId: data.__reqId,
				error: false,
				diff: this.executor.state.commit()
			});;
		} catch (err: any) {
			this.executor.state.reset();

			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}

	async runMany (data: { __reqId: string; list: { name: string; args: Record<string, any>; }[]; policy: 'strict' | 'loose'; diff: any; }) {
		try {
			this.executor.applyDiff(data.diff);

			const errors: string[] = [];

			for (const exec of data.list) {
				try {
					await this.executor.run(exec.name, exec.args);
				} catch (err: any) {
					if (data.policy === "strict") {
						throw err;
					} else {
						errors.push(`${exec.name} error: ${err.toString()}`);
					}
				}
			}

			this.response("result", {
				__reqId: data.__reqId,
				error: false,
				diff: this.executor.state.commit()
			});
		} catch (err: any) {
			this.executor.state.reset();

			this.response("result", {
				__reqId: data.__reqId,
				error: true,
				details: err.toString()
			});
		}
	}
}

new LagoonWorker();
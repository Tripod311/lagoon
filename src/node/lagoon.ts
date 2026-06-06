import { Worker } from "worker_threads"
import { randomUUID } from "crypto"
import State from "../common/state.js"
import Shipping from "../common/shipping.js"
import type { Ship } from "../common/shipping.js"
import WorkerBundle from "./worker.bundle.js"

import type { ExecutionResult, LagoonOptions } from "../common/types.js"

interface ExecutionWaiter {
	timeout?: ReturnType<typeof setTimeout>;
	startTime: number;
	resolve: (result: ExecutionResult) => void;
}

export default class Lagoon {
	private worker!: Worker;
	public state: State;
	public shipping: Shipping;

	private pingTimeout: number = 500;
	private pingTimeoutId?: ReturnType<typeof setTimeout>;

	private pending: Record<string, ExecutionWaiter> = {};

	constructor (options?: LagoonOptions) {
		if (options) {
			if (options.pingTimeout !== undefined) {
				this.pingTimeout = options.pingTimeout;
			}
		}

		this.state = new State();
		this.shipping = new Shipping(randomUUID, this.send.bind(this));

		this.setup();
	}

	destructor () {
		this.shipping.close();

		this.worker.terminate();

		clearTimeout(this.pingTimeoutId);

		for (const id in this.pending) {
			clearTimeout(this.pending[id].timeout);
			this.pending[id].resolve({
				error: true,
				details: "Shutdown"
			});
		}
	}

	send (command: string, data: any, timeout?: number): Promise<ExecutionResult> {
		return new Promise((resolve, reject) => {
			this.worker.postMessage({
				command,
				data
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
		this.worker.postMessage({
			command,
			data
		});
	}

	setup () {
		this.worker = new Worker(WorkerBundle, {
			eval: true
		});
		this.worker.on("message", this.handleMessage.bind(this));

		const id = randomUUID();

		this.send("setup", { __reqId: id, state: this.state.serialize() }).then((result: ExecutionResult) => {
			if (result.error) {
				console.error(`Setup error: ${result.details}`);
				this.worker.terminate();
				this.setup();
			} else {
				console.error(`Worker started`);
			}
		});
	}

	async forceSync () {
		const id = randomUUID();

		return this.send("sync", { __reqId: id, diff: this.state.commit() });
	}

	async registerFunction (name: string, code: string) {
		const id = randomUUID();

		return this.send("registerFunction", { __reqId: id, name: name, code: code });
	}

	async run (name: string, args: Record<string, any>, timeout: number = 0) {
		const id = randomUUID();

		return this.send("run", { __reqId: id, name: name, args: args, diff: this.state.commit() }, timeout);
	}

	async runMany (list: { name: string; args: Record<string, any>; }[], policy: 'strict' | 'loose' = 'loose', timeout: number = 0) {
		const id = randomUUID();

		return this.send("runMany", { __reqId: id, list: list, policy: policy, diff: this.state.commit() }, timeout);
	}

	async execute (code: string, args: Record<string, any>, timeout: number = 0) {
		const id = randomUUID();

		return this.send("execute", { __reqId: id, code: code, args: args, diff: this.state.commit() }, timeout);
	}

	handleMessage (data: { command: string; data: any; }) {
		switch (data.command) {
			case "pong":
				this.pongReceived();
				break;
			case "ship":
				this.shipReceived(data.data);
				break;
			case "shipResponse":
				this.shipResponse(data.data);
				break;
			case "result":
				this.resultReceived(data.data);
				break;
			default:
				break;
		}
	}

	sendPing () {
		this.send("ping", null);

		this.pingTimeoutId = setTimeout(this.pingTerminate.bind(this), this.pingTimeout);
	}

	pongReceived () {
		clearTimeout(this.pingTimeoutId);

		this.pingTimeoutId = setTimeout(this.sendPing.bind(this), this.pingTimeout);
	}

	pingTerminate () {
		this.worker.terminate();

		for (const id in this.pending) {
			clearTimeout(this.pending[id].timeout);

			this.pending[id].resolve({ error: true, details: "Worker killed (ping)" });
		}

		this.setup();
	}

	resultReceived (data: { __reqId: string; error: boolean; details?: string; diff?: Record<string, any>; data?: any; }) {
		const pending = this.pending[data.__reqId];

		if (pending) {
			clearTimeout(pending.timeout);

			if (data.diff) {
				this.state.applyDiff(data.diff);
			}

			pending.resolve({
				error: data.error,
				details: data.details,
				data: data.data
			});
		}
	}

	async shipReceived (data: { __reqId: string; data: Ship; }) {
		try {
			const ship = await this.shipping.handleShip(data.data);

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
}
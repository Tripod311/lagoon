import MessageBus from "./messageBus.js"
import type { Message } from "./messageBus.js"
import State from "./state.js"

type ShipListener = (payload: any) => Promise<void> | void;

export default abstract class Lagoon {
	private destroyed: boolean = false;
	public state: State;
	protected messageBus!: MessageBus;

	private pingTimeout: number;
	private pingTimeoutId?: any;

	private pendingExecutions: Set<string> = new Set();
	private shipListeners: Record<string, ShipListener> = {};

	protected beforeEach: string;
	protected afterEach: string;
	protected registeredFunctions: Record<string, string> = {};

	constructor (pingTimeout: number = 500, beforeEach: string = "", afterEach: string = "") {
		this.pingTimeout = pingTimeout;
		this.beforeEach = beforeEach;
		this.afterEach = afterEach;

		this.state = new State(true);
	}

	destructor () {
		this.destroyed = true;

		clearTimeout(this.pingTimeoutId);

		this.messageBus.destructor();

		this.destroyWorker();
	}

	attachMessageBusHandles () {
		this.messageBus.addEventListener("patch", this.handlePatch.bind(this));
		this.messageBus.addEventListener("ship", this.handleShip.bind(this));
	}

	sync () {
		return new Promise<void>((resolve, reject) => {
			this.messageBus.send("sync", this.state.serialize(), 0, (response: Message) => {
				if (response.data.error) {
					reject(response.data.details);
				} else {
					resolve();
				}
			});
		});
	}

	registerFunction (name: string, code: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.messageBus.send("registerFunction", { name, code }, 0, (response: Message) => {
				if (response.data.error) {
					reject(response.data.details);
				} else {
					this.registeredFunctions[name] = code;
					resolve();
				}
			});
		});
	}

	execute (code: string, args: Record<string, any>, timeout: number = 0): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const id = this.messageBus.send("execute", { code, args }, timeout, (response: Message) => {
				this.pendingExecutions.delete(response.reqId);

				if (response.data.error) {
					reject(response.data.details);
				} else {
					resolve();
				}
			});

			this.pendingExecutions.add(id);
		});
	}

	run (name: string, args: Record<string, any>, timeout: number = 0): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const id = this.messageBus.send("run", { name, args }, timeout, (response: Message) => {
				this.pendingExecutions.delete(response.reqId);

				if (response.data.error) {
					reject(response.data.details);
				} else {
					resolve();
				}
			});

			this.pendingExecutions.add(id);
		});
	}

	runMany (list: { name: string; args: Record<string, any>; }[], policy: 'strict' | 'loose' = 'strict', timeout: number = 0): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const id = this.messageBus.send("runMany", { list, policy }, timeout, (response: Message) => {
				this.pendingExecutions.delete(response.reqId);

				if (response.data.error) {
					reject(response.data.details);
				} else {
					resolve(response.data.data);
				}
			});

			this.pendingExecutions.add(id);
		});
	}

	ship (name: string, payload: any, timeout: number = 0, callback?: (result: any) => void): Promise<any> {
		return new Promise<any>((resolve, reject) => {
			this.messageBus.send("ship", { name, payload }, timeout, (response: Message) => {
				resolve(response.data);

				if (callback) callback(response.data);
			});
		});
	}

	async handleShip (msg: Message) {
		try {
			const name = msg.data.name;

			const listener = this.shipListeners[name];

			if (!listener) throw new Error(`Listener for ${name} not set`);

			const result = await listener(msg.data.payload);

			msg.response!({
				error: false,
				data: result
			});
		} catch (err: any) {
			msg.response!({
				error: true,
				details: err.toString()
			});
		}
	}

	handlePatch (msg: Message) {
		const runId = msg.data.runId;

		if (runId) {
			if (this.pendingExecutions.has(runId)) {
				this.messageBus.forceClearTimeout(runId);

				this.pendingExecutions.delete(runId);

				const correction = this.state.applyPatch(msg.data.patch);

				msg.response!({
					error: false,
					patch: correction
				});
			} else {
				msg.response!({
					error: true,
					details: "Run not found",
					patch: this.state.getPatch()
				});
			}
		} else {
			const correction = this.state.applyPatch(msg.data.patch);

			msg.response!({
				error: false,
				patch: correction
			});
		}
	}

	sendPing () {
		if (this.pingTimeout > 0) {
			this.messageBus.send("ping", {}, this.pingTimeout, (response: Message) => {
				if (response.data && response.data.error) {
					if (!this.destroyed) {
						console.log("Lagoon worker timeout. Restarting");

						this.pendingExecutions.clear();

						this.destroyWorker();
						this.createWorker();
					}
				} else {
					this.pingTimeoutId = setTimeout(this.sendPing.bind(this), this.pingTimeout);
				}
			})
		}
	}

	setShipListener (name: string, listener: ShipListener | null) {
		if (listener === null) {
			delete this.shipListeners[name];
		} else {
			this.shipListeners[name] = listener;
		}
	}

	abstract createWorker (): void;

	abstract destroyWorker (): void;
}
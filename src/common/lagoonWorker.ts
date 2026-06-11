import MessageBus from "./messageBus.js"
import type { Message } from "./messageBus.js"
import State from "./state.js"

export type CompiledFunction = (args: Record<string, any>) => Promise<void> | void;

type ShipListener = (payload: any) => Promise<void> | void;

interface QueuedCall {
	runId?: string;
	functions: { fn: CompiledFunction, args: Record<string, any>; }[];
	policy: 'strict' | 'loose';
	resolve: (errors: string[]) => void;
	reject: (err: any) => void;
}

export interface LogFunctions {
	log: (data: any) => void,
	error: (data: any) => void
}

export default abstract class LagoonWorker {
	public state!: State;
	public storage: Record<string, any> = {};
	protected messageBus!: MessageBus;

	protected compiledFunctions: Record<string, CompiledFunction> = {};
	private shipListeners: Record<string, ShipListener> = {};

	private processing: boolean = false;
	private queue: QueuedCall[] = [];

	protected beforeEach: string = "";
	protected afterEach: string = "";

	protected log: LogFunctions = {
		log: console.log,
		error: console.error
	};

	attachMessageBusHandles () {
		this.messageBus.addEventListener("ping", this.ping.bind(this));
		this.messageBus.addEventListener("sync", this.sync.bind(this));
		this.messageBus.addEventListener("registerFunction", this.registerFunction.bind(this));
		this.messageBus.addEventListener("execute", this.execute.bind(this));
		this.messageBus.addEventListener("run", this.run.bind(this));
		this.messageBus.addEventListener("runMany", this.runMany.bind(this));
		this.messageBus.addEventListener("ship", this.handleShip.bind(this));
	}

	ping (msg: Message) {
		msg.response!(null);
	}

	sync (msg: Message) {
		try {
			this.state = State.build(msg.data);

			msg.response!({
				error: false
			});
		} catch (err: any) {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			});
		}
	}

	registerFunction (msg: Message) {
		try {
			this.compiledFunctions[msg.data.name] = this.compile(msg.data.name, `${this.beforeEach}\n${msg.data.code}\n${this.afterEach}`);

			msg.response!({
				error: false
			});
		} catch (err: any) {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			});
		}
	}

	execute (msg: Message) {
		const runId = msg.reqId;

		let compiled;

		try {
			compiled = this.compile("generic", `${this.beforeEach}\n${msg.data.code}\n${this.afterEach}`);
		} catch (err: any) {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			});
			return;
		}

		const promise = new Promise((resolve, reject) => {
			this.queue.push({
				runId: runId,
				functions: [{ fn: compiled, args: msg.data.args }],
				policy: 'strict',
				resolve,
				reject
			});
		});

		promise.then(() => {
			msg.response!({
				error: false
			});
		}, (err: any) => {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			})
		});

		if (!this.processing) this.pullQueue();
	}

	async run (msg: Message) {
		const runId = msg.reqId;

		if (!this.compiledFunctions[msg.data.name]) {
			this.log.error(`Function ${msg.data.name} was not registered`);
			
			msg.response!({
				error: true,
				details: `Function ${msg.data.name} was not registered`
			});
			return;
		}

		const promise = new Promise((resolve, reject) => {
			this.queue.push({
				runId: runId,
				functions: [{ fn: this.compiledFunctions[msg.data.name], args: msg.data.args }],
				policy: 'strict',
				resolve,
				reject
			});
		});

		promise.then(() => {
			msg.response!({
				error: false
			});
		}, (err: any) => {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			})
		});

		if (!this.processing) this.pullQueue();
	}

	async runMany (msg: Message) {
		const runId = msg.reqId;

		const functions = msg.data.list.map((l: { name: string; args: Record<string, any>; }) => {
			return {
				fn: this.compiledFunctions[l.name] as CompiledFunction,
				args: l.args
			}
		});

		const promise = new Promise((resolve, reject) => {
			this.queue.push({
				runId: runId,
				functions: functions,
				policy: msg.data.policy,
				resolve,
				reject
			});
		});

		promise.then(() => {
			msg.response!({
				error: false
			});
		}, (err: any) => {
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			})
		});

		if (!this.processing) this.pullQueue();
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
			this.log.error(err.toString());

			msg.response!({
				error: true,
				details: err.toString()
			});
		}
	}

	ship (name: string, payload: any, timeout: number = 0, callback?: (args: Record<string, any>) => void): Promise<Record<string, any>> {
		return new Promise((resolve, reject) => {
			this.messageBus.send("ship", { name, payload }, timeout, (response: Message) => {
				resolve(response.data as Record<string, any>);

				if (callback) {
					const pr = new Promise((resolve, reject) => {
						this.queue.unshift({
							functions: [{ fn: callback, args: response.data as Record<string, any> }],
							policy: 'strict',
							resolve,
							reject
						});
					});

					pr.then(() => {
						// do nothing
					}, (err: any) => {
						this.log.error(`Ship callback error: ${err.toString()}`);
					});
				}
			});
		});
	}

	setShipListener (name: string, listener: ShipListener | null) {
		if (listener === null) {
			delete this.shipListeners[name];
		} else {
			this.shipListeners[name] = listener;
		}
	}

	enqueue (fn: string | CompiledFunction, args: Record<string, any>, immediate: boolean = false) {
		if (typeof fn === "string") {
			if (!this.compiledFunctions[fn]) throw new Error(`Function ${fn} was not registered`);

			fn = this.compiledFunctions[fn];
		}

		if (immediate) {
			const pr = new Promise<string[]>((resolve, reject) => {
				this.queue.unshift({
					functions: [{ fn, args }],
					policy: 'strict',
					resolve,
					reject
				});
			});

			pr.catch((err: any) => {
				this.log.error(`Enqueue error: ${err.toString()}`);
			});
		} else {
			const pr = new Promise<string[]>((resolve, reject) => {
				this.queue.push({
					functions: [{ fn, args }],
					policy: 'strict',
					resolve,
					reject
				});
			});

			pr.catch((err: any) => {
				this.log.error(`Enqueue error: ${err.toString()}`);
			});
		}
	}

	protected patchSync (runId?: string): Promise<void> {
		return new Promise((resolve) => {
			this.messageBus.send("patch", {
				runId: runId,
				patch: this.state.getPatch()
			}, 0, (response: Message) => {
				if (response.data.error) {
					this.state.reset();

					this.state.applyPatch(response.data.patch);
				} else {
					this.state.applyPatch(response.data.patch);
				}

				resolve();
			});
		});
	}

	private async pullQueue () {
		this.processing = true;

		await this.patchSync();

		while (this.queue.length > 0) {
			const q = this.queue.shift() as QueuedCall;

			const errors: string[] = [];

			for (const exec of q.functions) {
				try {
					await exec.fn(exec.args);
				} catch (err: any) {
					errors.push(err.toString());

					if (q.policy === 'strict') break;
				}
			}

			if (q.policy === 'strict' && errors.length > 0) {
				this.state.reset();

				await this.patchSync();

				q.reject(errors[0]);
			} else {
				await this.patchSync(q.runId);

				q.resolve(errors);
			}
		}

		this.processing = false;
	}

	abstract compile (name: string, code: string): CompiledFunction;

	abstract setup (): void;
}
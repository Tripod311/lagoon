import Shipping from "./shipping.js"
import State from "./state.js"

export type ExecutorFunction = (args: Record<string, any>) => Promise<void> | void;

interface QueuedCall {
	fn: ExecutorFunction;
	args: Record<string, any>;
	resolve: () => void;
	reject: (err: any) => void;
}

export default class Executor {
	public state: State;
	public shipping: Shipping;
	private functions: Record<string, ExecutorFunction> = {};

	private queue: QueuedCall[] = [];
	private processing: boolean = false;
	private diffQueue: any[] = [];

	constructor (state: State, shipping: Shipping) {
		this.state = state;
		this.shipping = shipping;
	}

	ship (name: string, payload: any, callback?: ExecutorFunction, timeout: number = 0): Promise<any> {
		const pr = this.shipping.ship(name, payload, timeout);

		if (callback) {
			pr.then((result: any) => {
				this.execute(callback, { err: null, payload: result });
			}, (err: any) => {
				this.execute(callback, { err: err, payload: null });
			});
		}

		return pr;
	}

	registerFunction (name: string, fn: ExecutorFunction) {
		this.functions[name] = fn;
	}

	run (name: string, args: Record<string, any>) {
		return new Promise<void>((resolve, reject) => {
			const fn = this.functions[name];

			if (!fn) reject(`Function ${name} is not registered`);

			this.queue.push({
				fn: fn,
				args: args,
				resolve,
				reject
			});

			if (!this.processing) this.pullQueue();
		});
	}

	execute (fn: ExecutorFunction, args: Record<string, any>) {
		return new Promise<void>((resolve, reject) => {
			this.queue.push({
				fn: fn,
				args: args,
				resolve,
				reject
			});

			if (!this.processing) this.pullQueue();
		});
	}

	applyDiff (diff: any) {
		this.diffQueue.push(diff);
	}

	private async pullQueue () {
		this.processing = true;

		while (this.queue.length > 0) {
			while (this.diffQueue.length > 0) {
				this.state.applyDiff(this.diffQueue.shift());
			}

			const q = this.queue.shift() as QueuedCall;

			try {
				q.fn(q.args);
				q.resolve();
			} catch (err: any) {
				q.reject(err);
			}
		}

		this.processing = false;
	}
}
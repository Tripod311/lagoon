import vm from "vm";
import { parentPort, workerData } from "worker_threads"
import { randomUUID } from "crypto"
import LagoonWorker from "../common/lagoonWorker.js"
import type { LogFunctions, CompiledFunction } from "../common/lagoonWorker.js"
import MessageBus from "../common/messageBus.js"
import State from "../common/state.js"

class NodeWorker extends LagoonWorker {
	private context: vm.Context;

	constructor (log?: LogFunctions) {
		super();

		if (log) {
			this.log = log;
		}

		this.setup();

		this.context = vm.createContext({
			Lagoon: {
				state: this.state,
				ship: this.ship.bind(this),
				enqueue: this.enqueue.bind(this)
			}
		});

		parentPort!.on("message", (data: any) => {
			// console.log(`WORKER IN: ${JSON.stringify(data)}`);

			this.messageBus.receive(data);
		});
	}

	compile (name: string, code: string): CompiledFunction {
		const wrappedCode = `
			(async (args) => {
				"use strict";
				${this.beforeEach}
				${code}
				${this.afterEach}
			})
		`;

		const script = new vm.Script(wrappedCode, {
			filename: `lagoon:${name}`,
		});

		const fn = script.runInContext(this.context, {
			timeout: 50,
		});

		if (typeof fn !== "function") {
			throw new Error(`Script "${name}" did not compile to a function`);
		}

		return async (args: Record<string, any>) => {
			await Promise.resolve(fn(args));
		};
	}

	setup (): void {
		this.state = State.build(workerData.state);

		this.beforeEach = workerData.beforeEach || "";
		this.afterEach = workerData.afterEach || "";

		for (const name in workerData.registeredFunctions) {
			this.compiledFunctions[name] = this.compile(name, `${workerData.registeredFunctions[name]}`);
		}

		this.messageBus = new MessageBus(randomUUID, (data: any) => {
			// console.log(`WORKER OUT: ${JSON.stringify(data)}`);

			parentPort!.postMessage(data);
		});

		this.attachMessageBusHandles();
	}
}

new NodeWorker();
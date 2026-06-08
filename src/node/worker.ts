import vm from "vm";
import { parentPort, workerData } from "worker_threads"
import { randomUUID } from "crypto"
import LagoonWorker from "../common/lagoonWorker.js"
import type { CompiledFunction } from "../common/lagoonWorker.js"
import MessageBus from "../common/messageBus.js"
import State from "../common/state.js"

class NodeWorker extends LagoonWorker {
	private context: vm.Context;

	constructor () {
		super();

		this.context = vm.createContext({
			Lagoon: {
				state: this.state,
				ship: this.ship.bind(this)
			}
		});

		parentPort!.on("message", (msg: any) => {
			this.messageBus.receive(msg);
		});
	}

	compile (name: string, code: string): CompiledFunction {
		const wrappedCode = `
			(async (args) => {
				"use strict";

				${code}
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
		this.state = State.build(workerData);

		this.messageBus = new MessageBus(randomUUID, parentPort!.postMessage.bind(parentPort));

		this.attachMessageBusHandles();
	}
}

new NodeWorker();
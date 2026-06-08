import { Worker } from "worker_threads"
import { randomUUID } from "crypto"
import WorkerBundle from "./worker.bundle.js"

import Lagoon from "../common/lagoon.js"
import MessageBus from "../common/messageBus.js"

export interface ResourceLimits {
	maxOldGenerationSizeMb: number,
	maxYoungGenerationSizeMb: number,
	stackSizeMb: number
}

export default class NodeLagoon extends Lagoon {
	private resourceLimits: ResourceLimits = {
		maxOldGenerationSizeMb: 64,
		maxYoungGenerationSizeMb: 16,
		stackSizeMb: 4
	}
	private worker!: Worker;

	constructor (pingTimeout?: number, resourceLimits?: ResourceLimits) {
		super(pingTimeout);

		if (resourceLimits) {
			this.resourceLimits = resourceLimits;
		}

		this.createWorker();
	}

	createWorker (): void {
		this.worker = new Worker(WorkerBundle, {
			eval: true,
			resourceLimits: this.resourceLimits,
			workerData: this.state.serialize()
		});
		this.worker.on("error", this.workerError.bind(this));

		this.messageBus = new MessageBus(randomUUID, (data: any) => {
			// console.log(`MAIN OUT: ${JSON.stringify(data)}`);

			this.worker.postMessage(data);
		});

		this.worker.on("message", (data: any) => {
			// console.log(`MAIN IN: ${JSON.stringify(data)}`);

			this.messageBus.receive(data);
		});

		this.attachMessageBusHandles();
	}

	destroyWorker (): void {
		this.worker.terminate();
	}

	private workerError (err: any) {
		console.log(`Worker error: ${err.toString()}`);

		this.destroyWorker();
		this.createWorker();
	}
}
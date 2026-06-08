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
			this.destroyWorker();
			this.createWorker();
		}
	}

	createWorker (): void {
		this.worker = new Worker(WorkerBundle, {
			eval: true,
			resourceLimits: this.resourceLimits,
			workerData: this.state.serialize()
		});
		this.worker.on("message", this.messageBus.receive.bind(this.messageBus));

		this.messageBus = new MessageBus(randomUUID, this.worker.postMessage.bind(this.worker));

		this.attachMessageBusHandles();
	}

	destroyWorker (): void {
		this.worker.terminate();
	}
}
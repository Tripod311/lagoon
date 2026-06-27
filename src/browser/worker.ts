import LagoonWorker from "../common/lagoonWorker.js"
import type { CompiledFunction } from "../common/lagoonWorker.js"
import MessageBus from "../common/messageBus.js"
import State from "../common/state.js"

class BrowserWorker extends LagoonWorker {
	private parentWindow: any;

	constructor () {
		super();
		
		this.parentWindow = window.parent;

		window.addEventListener("message", this.handleMessage);

		this.setup();

		this.messageBus.send("workerReady", {});
	}

	compile (name: string, code: string): CompiledFunction {
		const wrappedCode = `
			"use strict";

			return (async (Lagoon, args) => {
				"use strict";
				${this.beforeEach}
				${code}
				${this.afterEach}
			});
		`;

		const factory = new Function(wrappedCode);
		const fn = factory().bind({}, this);

		if (typeof fn !== "function") {
			throw new Error(`Script "${name}" did not compile to a function`);
		}

		return async (args: Record<string, any>) => {
			await Promise.resolve(fn(args));
		};
	}

	setup (): void {
		this.state = new State(false);

		this.messageBus = new MessageBus(() => crypto.randomUUID(), this.sendMessage);

		this.messageBus.addEventListener("initialize", this.initialize.bind(this));

		this.attachMessageBusHandles();
	}

	private initialize (msg: any) {
		this.state = State.build(msg.data.state);
		this.beforeEach = msg.data.beforeEach || "";
		this.afterEach = msg.data.afterEach || "";

		for (const name in msg.data.registeredFunctions) {
			this.compiledFunctions[name] = this.compile(name, `${msg.data.registeredFunctions[name]}`);
		}
	}

	private sendMessage = (msg: any) => {
		this.parentWindow.postMessage({
			token: (window as any).__LAGOON_TOKEN__,
			message: msg
		}, "*");
	}

	private handleMessage = (ev: MessageEvent) => {
		const data = ev.data;

		if (data.token !== (window as any).__LAGOON_TOKEN__) return;
		
		this.messageBus.receive(data.message);
	}
}

new BrowserWorker();
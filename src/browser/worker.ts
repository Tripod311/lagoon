import LagoonWorker from "../common/lagoonWorker.js"
import type { CompiledFunction } from "../common/lagoonWorker.js"
import MessageBus from "../common/messageBus.js"
import State from "../common/state.js"

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

class BrowserWorker extends LagoonWorker {
	constructor () {
		super();

		window.addEventListener("message", this.handleMessage);
	}

	compile (name: string, code: string): CompiledFunction {
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

	setup (): void {
		this.messageBus = new MessageBus(crypto.randomUUID, this.sendMessage);

		this.attachMessageBusHandles();

		this.patchSync();
	}

	private sendMessage = (msg: any) => {
		window.parent.postMessage({
			token: (window as any).__LAGOON_TOKEN__,
			message: msg
		});
	}

	private handleMessage = (ev: MessageEvent) => {
		const data = ev.data;

		if (data.token !== (window as any).__LAGOON_TOKEN__) return;

		this.messageBus.receive(data.message);
	}
}

new BrowserWorker();
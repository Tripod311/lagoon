import WorkerBundle from "./worker.bundle.js"

import Lagoon from "../common/lagoon.js"
import MessageBus from "../common/messageBus.js"

export default class BrowserLagoon extends Lagoon {
	private iframe!: HTMLIFrameElement;
	private token: string = "";
	private iframeURL: string = "";

	constructor (pingTimeout?: number, beforeEach?: string, afterEach?: string) {
		super(pingTimeout, beforeEach, afterEach);

		this.createWorker();
	}

	createWorker (): void {
		this.token = crypto.randomUUID();
		this.iframe = document.createElement("iframe");

		this.iframe.sandbox.add("allow-scripts");
		this.iframe.style.display = "none";

		this.messageBus = new MessageBus(() => crypto.randomUUID(), this.sendMessage, false);
		this.messageBus.addEventListener("workerReady", this.onWorkerReady.bind(this));

		this.attachMessageBusHandles();

		window.addEventListener("message", this.handleMessage);

	    const html = this.createHTML();

		const blob = new Blob([html], {
			type: "text/html;charset=utf-8"
		});

		this.iframeURL = URL.createObjectURL(blob);
		this.iframe.src = this.iframeURL;

		document.body.appendChild(this.iframe);
	}

	destroyWorker (): void {
		this.messageBus.destructor();

		this.iframe.onload = null;
		
		window.removeEventListener("message", this.handleMessage);
	    this.iframe.remove();
	    this.token = "";
	    URL.revokeObjectURL(this.iframeURL);
	}

	onWorkerReady () {
		this.messageBus.send("initialize", {
			state: this.state.serialize(),
			beforeEach: this.beforeEach,
			afterEach: this.afterEach,
			registeredFunctions: this.registeredFunctions
		});
		this.sendPing();
		this.messageBus.flush();
	}

	private handleMessage = (ev: MessageEvent) => {
		const data = ev.data;

		if (data.token !== this.token) return;
		
		this.messageBus.receive(data.message);
	}

	private sendMessage = (data: any) => {
		this.iframe.contentWindow!.postMessage({
			token: this.token,
			message: data
		}, "*");
	}

	private createHTML (): string {
				return `
<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">
</head>
<body>
<script>
window.__LAGOON_TOKEN__ = ${JSON.stringify(this.token)};
</script>
<script>
${WorkerBundle}
</script>
</body>
</html>
`;
	}
}
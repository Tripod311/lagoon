import WorkerBundle from "./worker.bundle.js"

import Lagoon from "../common/lagoon.js"
import MessageBus from "../common/messageBus.js"

export default class BrowserLagoon extends Lagoon {
	private iframe!: HTMLIFrameElement;
	private token: string = "";

	constructor (pingTimeout?: number) {
		super(pingTimeout);

		this.createWorker();
	}

	createWorker (): void {
		this.token = crypto.randomUUID();
		this.iframe = document.createElement("iframe");

	    this.iframe.sandbox.add("allow-scripts");

	    this.iframe.style.display = "none";
	    this.iframe.srcdoc = this.createHTML();

	    document.body.appendChild(this.iframe);

		this.messageBus = new MessageBus(crypto.randomUUID, this.sendMessage);

		this.attachMessageBusHandles();

		window.addEventListener("message", this.handleMessage);

		this.sync();

		this.sendPing();
	}

	destroyWorker (): void {
		this.messageBus.destructor();
		
		window.removeEventListener("message", this.handleMessage);
	    this.iframe.remove();
	    this.token = "";
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
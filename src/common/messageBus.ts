import Emitter from "./emitter.js"

export interface Message {
	command: string;
	data: any;
	reqId: string;
	isResponse: boolean;
	response?: (data: any) => void;
}

export type MessageHandler = (msg: Message) => void | Promise<void>;

interface MessageWaiter {
	timeout?: any;
	handler: MessageHandler;
}

export default class MessageBus extends Emitter {
	private genId: () => string;
	private sendFunction: (data: any) => void;
	private pending: Record<string, MessageWaiter> = {};

	constructor (genId: () => string, sendFunction: (data: any) => void) {
		super();

		this.genId = genId;
		this.sendFunction = sendFunction;
	}

	destructor () {
		const waiters = Object.values(this.pending);
		this.pending = {};

		for (const waiter of waiters) {
			clearTimeout(waiter.timeout);

			waiter.handler({
				command: "shutdown",
				data: {
					error: true,
					details: "Closed"
				},
				reqId: "",
				isResponse: true
			});
		}
	}

	send (command: string, data: any, timeout: number = 0, callback?: MessageHandler): string {
		const id = this.genId();

		if (callback) {
			this.pending[id] = {
				handler: callback
			}

			if (timeout > 0) {
				this.pending[id].timeout = setTimeout(() => {
					const handler = this.pending[id].handler;
					delete this.pending[id];

					handler({
						command: command,
						data: {
							error: true,
							details: "Timeout"
						},
						reqId: id,
						isResponse: true
					});
				}, timeout);
			}
		}

		this.sendFunction({
			command: command,
			data: data,
			reqId: id,
			isResponse: false
		});

		return id;
	}

	response (msg: Message, responseData: any) {
		this.sendFunction({
			command: msg.command,
			data: responseData,
			reqId: msg.reqId,
			isResponse: true
		});
	}

	receive (msg: Message) {
		if (msg.isResponse) {
			if (this.pending[msg.reqId]) {
				clearTimeout(this.pending[msg.reqId].timeout);

				const handler = this.pending[msg.reqId].handler;
				delete this.pending[msg.reqId];

				handler(msg);
			}
		} else {
			msg.response = this.response.bind(this, msg);

			this.emit(msg.command, msg);
		}
	}

	forceClearTimeout (id: string) {
		if (this.pending[id]) {
			clearTimeout(this.pending[id].timeout);
		}
	}
}
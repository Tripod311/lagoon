type Handler = (data: any) => void;

export default class Emitter {
	private handlers: Record<string, Handler[]> = {};

	addEventListener (name: string, handler: Handler) {
		if (this.handlers[name] === undefined) {
			this.handlers[name] = [];
		}

		this.handlers[name].push(handler);
	}

	removeEventListener (name: string, handler: Handler) {
		if (this.handlers[name]) {
			this.handlers[name] = this.handlers[name].filter(h => h !== handler);

			if (this.handlers[name].length === 0) delete this.handlers[name];
		}
	}

	emit (name: string, data: any) {
		if (this.handlers[name] !== undefined) {
			const list = this.handlers[name].slice();

			for (const handler of list) {
				handler(data);
			}
		}
	}
}
import type { ExecutionResult, SendFunction } from "./types.js"

export interface Ship {
	name: string;
	payload: any;
}

export type ShipListener = (payload: any) => Promise<any>;

export default class Shipping {
	private genId: () => string;
	private send: SendFunction;
	private listeners: Record<string, ShipListener> = {};
	private closed: boolean = false;

	constructor (genId: () => string, send: SendFunction) {
		this.genId = genId;
		this.send = send;
	}

	close () {
		this.closed = true;
	}

	async ship (name: string, payload: any, timeout: number = 0): Promise<any> {
		if (this.closed) throw new Error("Shipping closed");

		const id = this.genId();

		const response = await this.send("ship", {
			__reqId: id,
			data: { name, payload }
		});

		if (response.error) {
			throw new Error(response.details);
		} else {
			return response.data.payload;
		}
	}

	async handleShip (ship: Ship): Promise<Ship> {
		const listener = this.listeners[ship.name];

		if (!listener) {
			throw new Error(`Listener for ship ${ship.name} is not set`);
		} else {
			const responsePayload = await listener(ship.payload);

			return { name: ship.name, payload: responsePayload };
		}
	}

	setListener (name: string, listener: ShipListener | null) {
		if (listener === null) {
			delete this.listeners[name];
		} else {
			this.listeners[name] = listener;
		}
	}
}
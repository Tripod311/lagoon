import { Pump, Pipe, StoragePipe } from "@tripod311/pump"

type PipeListener = (newOutput: any, oldOutput: any) => void;

interface StateEntry {
	__value?: any;
	[key: string]: StateEntry;
}

export default class State {
	private isMainState: boolean;
	private value: Pump;
	private diff: Record<string, { old: any; current: any; }> = {};
	private fieldListeners: Record<string, PipeListener[]> = {};
	private locked: boolean = false;

	constructor (isMainState: boolean) {
		this.isMainState = isMainState;
		this.value = new Pump();
	}

	set (fieldName: string, value: any) {
		if (fieldName.length === 0) return;

		const hops = fieldName.split('.');

		let root: Pump | Pipe = this.value;
		let index = 0;
		while (index < hops.length) {
			const hop = hops[index];
			const pipe: Pipe | null = root.getPipe(hop);

			if (pipe) {
				root = pipe;
				index++;
			} else {
				break;
			}
		}

		if (index < hops.length) {
			for (let i=index; i<hops.length; i++) {
				const newPipe = new StoragePipe<any>();
				root.addPipe(hops[i], newPipe);
				newPipe.on(this.handleFieldChange.bind(this, newPipe.fullPath.join('.')));
				root = newPipe;
			}
		}

		(root as StoragePipe).data = value;
	}

	get (fieldName: string): any {
		const pipe = this.value.getPipe(fieldName);

		if (pipe) {
			return (pipe as StoragePipe).data;
		} else {
			return null;
		}
	}

	handleFieldChange (fieldName: string, newOutput: any, oldOutput: any) {
		if (this.locked) return;
		
		if (this.diff[fieldName]) {
			this.diff[fieldName].current = newOutput;
		} else {
			this.diff[fieldName] = {
				current: newOutput,
				old: oldOutput
			}
		}

		const listeners = this.fieldListeners[fieldName];

		if (listeners) {
			for (const l of listeners) {
				l(newOutput, oldOutput);
			}
		}
	}

	addFieldListener (fieldName: string, listener: PipeListener) {
		if (!this.isMainState) throw new Error(`Field listeners can be set only in main process`);

		if (!this.fieldListeners[fieldName]) {
			this.fieldListeners[fieldName] = [];
		}

		this.fieldListeners[fieldName].push(listener)
	}

	removeFieldListener (fieldName: string, listener: PipeListener) {
		if (!this.isMainState) throw new Error(`Field listeners can be set only in main process`);
		
		if (this.fieldListeners[fieldName] !== undefined) {
			this.fieldListeners[fieldName] = this.fieldListeners[fieldName].filter(l => l !== listener);

			if (this.fieldListeners[fieldName].length === 0) delete this.fieldListeners[fieldName];
		}
	}

	reset () {
		this.locked = true;

		for (const fieldName in this.diff) {
			this.set(fieldName, this.diff[fieldName].old);
		}

		this.diff = {};

		this.locked = false;
	}

	getPatch () {
		const result: Record<string, any> = {};

		for (const fieldName in this.diff) {
			result[fieldName] = this.diff[fieldName].current;
		}

		if (this.isMainState) this.diff = {};

		return result;
	}

	applyPatch (patch: Record<string, any>): Record<string, any> {
		const correction: Record<string, any> = {};

		this.locked = true;

		if (this.isMainState) {
			const changedFields = Object.keys(this.diff).concat(Object.keys(patch));

			for (const field of changedFields) {
				if (this.diff[field]) {
					correction[field] = this.diff[field].current;
				} else {
					this.set(field, patch[field]);
				}
			}
		} else {
			for (const field in patch) {
				this.set(field, patch[field]);
			}
		}

		this.diff = {};

		this.locked = false;

		return correction;
	}

	static build (base: Record<string, StateEntry>): State {
		const result = new State(false);

		const fill = (path: string[], entry: StateEntry) => {
			if (entry.__value !== undefined) result.set(path.join('.'), entry.__value);

			for (const sub in entry) {
				if (sub === "__value") continue;

				const subPath = path.slice();
				subPath.push(sub);

				fill(subPath, entry[sub]);
			}
		}

		for (const name in base) {
			fill([name], base[name]);
		}

		return result;
	}

	serialize (): Record<string, StateEntry> {
		const result: Record<string, StateEntry> = {};

		const fill = (pipe: StoragePipe): StateEntry => {
			const result: StateEntry = {};

			if (pipe.data) result.__value = pipe.data;

			const nested = pipe.nested;

			for (const name of nested) {
				result[name] = fill((pipe.getPipe(name) as StoragePipe));
			}

			return result;
		}

		for (const name of this.value.nested) {
			result[name] = fill((this.value.getPipe(name) as StoragePipe));
		}

		return result;
	}
}
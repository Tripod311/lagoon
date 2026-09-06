import { Pump, Pipe, StoragePipe } from "@tripod311/pump"

type PipeListener = (newOutput: any, oldOutput: any) => void;

interface StateEntry {
	__value?: any;
	[key: string]: StateEntry;
}

type StatePatch = Record<string, any>;

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

	getPipeWithCheck (fieldName: string): StoragePipe<any> | null {
		const hops = this.value.parsePath(fieldName);

		if (this.value.getPipe(hops[0]) === null) return null;

		let node = this.value.getPipe(hops[0]) as StoragePipe<any>;

		if (node === null || node.data === null) return null;

		for (let i=1; i<hops.length; i++) {
			node = node.getPipe(hops[i]) as StoragePipe<any>;

			if (node === null || node.data === null) return null;
		}

		return node;
	}

	set (fieldName: string, value: any, silent: boolean = false) {
		if (value === undefined) throw new Error("undefined is restricted value for set");

		if (fieldName.length === 0) return;

		const hops = this.value.parsePath(fieldName);

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
				newPipe.data = true;
				root.addPipe(hops[i], newPipe);
				newPipe.on(this.handleFieldChange.bind(this, newPipe.fullPath.join('.')));
				root = newPipe;
			}
		}

		const oldVal = (root as StoragePipe).data;
		(root as StoragePipe).data = value;

		if (!silent) {
			const listeners = this.fieldListeners[fieldName];

			if (listeners) {
				for (const l of listeners) {
					l(value, oldVal);
				}
			}
		}
	}

	get (fieldName: string): any {
		const pipe = this.getPipeWithCheck(fieldName);

		if (pipe === null) {
			return null;
		} else {
			return pipe.data;
		}
	}

	exists (fieldName: string): boolean {
		const pipe = this.getPipeWithCheck(fieldName);

		if (pipe === null) {
			return false;
		} else {
			return true;
		}
	}

	delete (fieldName: string) {
		this.set(fieldName, null, true);
	}

	getNested (fieldName: string): string[] {
		const pipe = this.getPipeWithCheck(fieldName);

		if (pipe === null) {
			return [];
		} else {
			return pipe.nested;
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

		try {
			for (const fieldName in this.diff) {
				this.set(fieldName, this.diff[fieldName].old);
			}

			this.diff = {};
		} catch (err: any) {
			console.error(err);
		} finally {
			this.locked = false;
		}
	}

	getPatch (): StatePatch {
		const result: StatePatch = {};

		for (const fieldName in this.diff) {
			result[fieldName] = this.diff[fieldName].current;
			if (this.diff[fieldName].current === null) {
				try {
					this.value.removePipeAt(fieldName)
				} catch (err: any) {
					// do nothing, pipe already removed
				}
			}
		}

		this.diff = {};

		return result;
	}

	applyPatch (patch: StatePatch): StatePatch {
		const correction: StatePatch = {};

		this.locked = true;

		if (this.isMainState) {
			const changedFields = Object.keys(this.diff).concat(Object.keys(patch)).sort();

			for (const field of changedFields) {
				if (this.diff[field]) {
					correction[field] = this.diff[field].current;
				} else {
					if (patch[field] === null) {
						try {
							this.value.removePipeAt(field)
						} catch (err: any) {
							// do nothing, pipe already removed
						}
					} else {
						this.set(field, patch[field]);
					}
				}
			}
		} else {
			for (const field in patch) {
				if (patch[field] === null) {
					try {
						this.value.removePipeAt(field)
					} catch (err: any) {
						// do nothing, pipe already removed
					}
				} else {
					this.set(field, patch[field]);
				}
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

			if (pipe.data !== undefined) result.__value = pipe.data;

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
import { Pump, Pipe, StoragePipe } from "@tripod311/pump"

type PipeListener = (newOutput: any, oldOutput: any) => void;

interface StateEntry {
	__value?: any;
	[key: string]: StateEntry;
}

type StatePatch = Record<string, any>;
interface PatchNode {
	patchValue?: any;
	diffValue?: any;
	children: Record<string, PatchNode>;
}

export default class State {
	private isMainState: boolean;
	private value: Pump;
	private diff: Record<string, { old: any; current: any; }> = Object.create(null);
	private fieldListeners: Record<string, PipeListener[]> = {};

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

	cleanupTree (node: Pump | StoragePipe<any>) {
		const nested = node.nested;

		for (const name of nested) {
			const child = node.getPipe(name) as StoragePipe<any>;

			if (child.data === null) {
				node.removePipe(name);
			} else {
				this.cleanupTree(child);
			}
		}
	}

	private recordDiff (
		fieldName: string,
		oldValue: any,
		newValue: any
	) {
		const change = this.diff[fieldName];

		if (change) {
			change.current = structuredClone(newValue);

			if (Object.is(change.old, newValue)) {
				delete this.diff[fieldName];
			}

			return;
		}

		if (Object.is(oldValue, newValue)) return;

		this.diff[fieldName] = {
			old: structuredClone(oldValue),
			current: structuredClone(newValue)
		};
	}

	private isDescendant (
		path: string,
		parent: string
	): boolean {
		return path.startsWith(`${parent}.`);
	}

	private pathDepth (path: string): number {
		return path.split(".").length;
	}

	set (fieldName: string, value: any, skipDiff: boolean = false) {
		if (value === undefined) throw new Error("undefined is restricted value for set");

		const hops = this.value.parsePath(fieldName);

		let root: Pump | Pipe = this.value;
		let index = 0;
		while (index < hops.length) {
			const hop = hops[index];
			const pipe = root.getPipe(hop) as StoragePipe<any>;

			if (pipe) {
				if (pipe.data === null) {
					pipe.data = true;
					if (!skipDiff) this.recordDiff(pipe.fullPath.join('.'), null, true);
				}
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
				root = newPipe;

				if (!skipDiff) {
					this.recordDiff(
						root.fullPath.join("."),
						null,
						true
					);
				}
			}
		}

		const oldVal = structuredClone((root as StoragePipe).data);
		const newVal = structuredClone(value);

		(root as StoragePipe).data = newVal;

		if (!skipDiff) this.recordDiff(fieldName, oldVal, newVal)

		const listeners = this.fieldListeners[fieldName];

		if (listeners) {
			for (const l of listeners) {
				l(
					structuredClone(newVal),
					structuredClone(oldVal)
				);
			}
		}
	}

	get (fieldName: string): any {
		const pipe = this.getPipeWithCheck(fieldName);

		if (pipe === null) {
			return null;
		} else {
			return structuredClone(pipe.data);
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
		const pipe = this.getPipeWithCheck(fieldName);

		if (pipe !== null) {
			this.set(fieldName, null);
		}
	}

	getNested (fieldName: string): string[] {
		const pipe = this.getPipeWithCheck(fieldName);

		if (!pipe) return [];

		return pipe.nested.filter(name => {
			const child = pipe.getPipe(name) as StoragePipe<any>;

			return child !== null && child.data !== null;
		});
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

	static build (base: Record<string, StateEntry>): State {
		const result = new State(false);

		const fill = (path: string[], entry: StateEntry) => {
			if (entry.__value !== undefined) result.set(path.join('.'), entry.__value, true);

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
		const result: Record<string, StateEntry> =
			Object.create(null);

		const fill = (
			pipe: StoragePipe<any>
		): StateEntry | null => {
			if (pipe.data === null) return null;

			const entry: StateEntry =
				Object.create(null);

			if (pipe.data !== undefined) {
				entry.__value = pipe.data;
			}

			for (const name of pipe.nested) {
				const child = pipe.getPipe(name);

				if (!child) continue;

				const childEntry = fill(
					child as StoragePipe<any>
				);

				if (childEntry !== null) {
					entry[name] = childEntry;
				}
			}

			return entry;
		};

		for (const name of this.value.nested) {
			const pipe = this.value.getPipe(name);

			if (!pipe) continue;

			const entry = fill(
				pipe as StoragePipe<any>
			);

			if (entry !== null) {
				result[name] = entry;
			}
		}

		return result;
	}

	reset () {
		const fields = Object.keys(this.diff).sort(
			(first, second) =>
				this.pathDepth(second) -
				this.pathDepth(first)
		);

		for (const fieldName of fields) {
			this.set(
				fieldName,
				this.diff[fieldName].old,
				true
			);
		}

		this.cleanupTree(this.value);
		this.diff = Object.create(null);
	}

	getPatch (): StatePatch {
		const result: StatePatch =
			Object.create(null);

		const fields = Object.keys(this.diff).sort(
			(first, second) =>
				this.pathDepth(first) -
				this.pathDepth(second)
		);

		const deletedRoots: string[] = [];

		for (const fieldName of fields) {
			const coveredByDeletion = deletedRoots.some(parent =>
				this.isDescendant(fieldName, parent)
			);

			if (coveredByDeletion) continue;

			const value = this.diff[fieldName].current;

			result[fieldName] = structuredClone(value);

			if (value === null) {
				deletedRoots.push(fieldName);
			}
		}

		return result;
	}

	applyPatch (patch: StatePatch): StatePatch {
		const correction: StatePatch =
			Object.create(null);

		const patchFields = Object.keys(patch);

		/*
		 * Validate the complete patch before changing state.
		 */
		for (const field of patchFields) {
			this.value.parsePath(field);

			if (patch[field] === undefined) {
				throw new Error(
					`Patch contains undefined value for "${field}"`
				);
			}
		}

		/*
		 * A deletion must cover the complete subtree.
		 * A patch containing both `user: null` and
		 * `user.name: value` is contradictory.
		 */
		for (const field of patchFields) {
			if (patch[field] !== null) continue;

			const conflictingChild = patchFields.find(other =>
				this.isDescendant(other, field)
			);

			if (conflictingChild) {
				throw new Error(
					`Patch modifies "${conflictingChild}" ` +
					`inside deleted node "${field}"`
				);
			}
		}

		if (this.isMainState) {
			this.applyPatchMain(patch, correction);
		} else {
			this.applyPatchWorker(patch);
		}

		this.diff = Object.create(null);
		this.cleanupTree(this.value);

		return correction;
	}

	private buildPatchTree (
		patch: StatePatch
	): PatchNode {
		const root: PatchNode = {
			children: Object.create(null)
		};

		const changedFields = new Set([
			...Object.keys(this.diff),
			...Object.keys(patch)
		]);

		for (const fieldName of changedFields) {
			const hops = this.value.parsePath(fieldName);

			let node = root;

			for (let index = 0; index < hops.length; index++) {
				const hop = hops[index];
				const nodePath = hops
					.slice(0, index + 1)
					.join(".");

				if (!node.children[hop]) {
					node.children[hop] = {
						patchValue: patch[nodePath],
						diffValue:
							this.diff[nodePath]?.current,
						children: Object.create(null)
					};
				}

				node = node.children[hop];
			}
		}

		return root;
	}

	private hasDiffInSubtree (
		node: PatchNode
	): boolean {
		if (node.diffValue !== undefined) {
			return true;
		}

		return Object.values(node.children).some(child =>
			this.hasDiffInSubtree(child)
		);
	}

	private collectDiffCorrections (
		fullName: string,
		node: PatchNode,
		correction: StatePatch
	) {
		if (node.diffValue !== undefined) {
			correction[fullName] =
				structuredClone(node.diffValue);

			if (node.diffValue === null) {
				return;
			}
		}

		for (const childName of Object.keys(node.children)) {
			this.collectDiffCorrections(
				`${fullName}.${childName}`,
				node.children[childName],
				correction
			);
		}
	}

	private applyPatchMain (
		patch: StatePatch,
		correction: StatePatch
	) {
		const patchTree = this.buildPatchTree(patch);

		const apply = (
			fullName: string,
			node: PatchNode
		) => {
			/*
			 * Main deleted this node. Main always wins,
			 * so worker receives the deletion and the
			 * complete subtree is skipped.
			 */
			if (node.diffValue === null) {
				correction[fullName] = null;
				return;
			}

			/*
			 * Worker wants to delete this subtree.
			 */
			if (node.patchValue === null) {
				if (this.hasDiffInSubtree(node)) {
					/*
					 * Something inside the subtree was
					 * changed by main. Reject the worker's
					 * deletion and restore the root value
					 * in worker.
					 */
					const current =
						this.getPipeWithCheck(fullName);

					if (!current) {
						throw new Error(
							`Cannot restore state node "${fullName}"`
						);
					}

					correction[fullName] =
						structuredClone(current.data);

					this.collectDiffCorrections(
						fullName,
						node,
						correction
					);
				} else {
					/*
					 * Main did not touch this subtree, so
					 * worker's deletion can be applied.
					 */
					const current =
						this.getPipeWithCheck(fullName);

					if (current) {
						this.set(fullName, null, true);
					}
				}

				return;
			}

			const hasDiff =
				node.diffValue !== undefined;

			const hasPatch =
				node.patchValue !== undefined;

			if (hasDiff) {
				/*
				 * Exact conflict or a main-only change:
				 * main value is authoritative.
				 */
				correction[fullName] =
					structuredClone(node.diffValue);
			} else if (hasPatch) {
				/*
				 * Worker-only change.
				 */
				this.set(
					fullName,
					node.patchValue,
					true
				);
			}

			for (const childName of Object.keys(node.children)) {
				apply(
					`${fullName}.${childName}`,
					node.children[childName]
				);
			}
		};

		for (const name of Object.keys(patchTree.children)) {
			apply(
				name,
				patchTree.children[name]
			);
		}
	}

	private applyPatchWorker (patch: StatePatch) {
		const fields = Object.keys(patch).sort(
			(first, second) =>
				this.pathDepth(first) -
				this.pathDepth(second)
		);

		for (const field of fields) {
			if (
				patch[field] === null &&
				this.getPipeWithCheck(field) === null
			) {
				continue;
			}

			this.set(
				field,
				patch[field],
				true
			);
		}
	}
}
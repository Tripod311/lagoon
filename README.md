# Lagoon

**Lagoon** is an isolated sandbox for running untrusted, user-provided, or potentially broken scripts.

It does not provide perfect CPU-level isolation, but it prevents untrusted code from directly mutating the main process state or accessing capabilities that were not explicitly exposed to it.

Lagoon is available for both Node.js and browsers:

- **Node.js**: isolation is based on `worker_threads` + `vm` with a restricted execution context.
- **Browser**: isolation is based on a sandboxed `iframe` with strict CSP policies.

Both environments expose the same public API.

---

## Why Lagoon?

Lagoon is useful when you need to execute code that may come from an untrusted source, contain bugs, or even be intentionally malicious.

Examples:

- user-created scripts;
- plugins;
- modding systems;
- AI-generated code;
- automation rules;
- game scripting;
- dynamic business logic.

Instead of running that code directly inside your main application, Lagoon runs it inside an isolated environment with limited access to data and APIs.

The main process always remains authoritative. Untrusted code can propose state changes, request data through controlled channels, and return results, but it cannot directly modify the main application.

---

## Security Model

### Node.js

In Node.js, Lagoon uses a worker thread and a restricted `vm` context.

This helps protect the main process from:

- direct access to `process`, `fs`, networking APIs, or other dangerous globals unless explicitly exposed;
- accidental or malicious state corruption;
- infinite loops blocking the main event loop;
- excessive memory usage, within the limits provided by Node.js worker resource limits.

However, this is **not a perfect security boundary**.

Important notes:

- `vm` should not be treated as a complete security sandbox by itself.
- Worker memory limits reduce the risk of memory exhaustion, but do not make abuse impossible.
- CPU isolation is cooperative: Lagoon detects an unresponsive worker via ping timeout and recreates it.
- Native Node.js vulnerabilities, exposed APIs, or unsafe host bindings can still break isolation.

In practice, Lagoon is designed to make untrusted code much harder to abuse and much safer to run, but it should still be used carefully for highly hostile code.

### Browser

In the browser, Lagoon uses a sandboxed `iframe` with strict Content Security Policy rules.

This prevents sandboxed code from:

- accessing the parent page directly;
- reading application data unless it is explicitly passed in;
- making unauthorized requests from the user’s main page context;
- using browser capabilities that were not allowed by the sandbox configuration.

The browser version is especially useful for client-side scripting, modding, and controlled execution of user-defined logic.

---

## Installation

```bash
npm install @tripod311/lagoon
```

---

## Basic Usage

```ts
import Lagoon from "@tripod311/lagoon/browser";

/*
  For Node.js:

  import Lagoon from "@tripod311/lagoon/node";
*/

const lagoon = new Lagoon(500);

lagoon.state.set("myVariable", 10);

async function runUnsafeCode() {
  const code = `
    const value = Lagoon.state.get("myVariable");
    Lagoon.state.set("result", value + args.arg1 + args.arg2);
  `;

  const result = await lagoon.execute(code, {
    arg1: 1,
    arg2: 2,
  });

  if (result.error) {
    console.error(`Unsafe code failed: ${result.details}`);
  } else {
    console.log("Unsafe code executed");
  }
}

runUnsafeCode();
```

The browser and Node.js versions have the same API. The only difference is the import path.

---

## Core Idea

Lagoon communicates through synchronized state.

There are two sides:

- the **main environment**;
- the **isolated environment**.

The main environment is always authoritative.

Sandboxed code can read and modify its local state copy during execution. After the function finishes successfully, Lagoon sends the resulting state patch back to the main environment.

If the function fails, times out, or the environment is destroyed, its state changes are discarded.

Functions inside the isolated environment are executed sequentially.

---

## Constructor

```ts
/* Browser */
const lagoon = new Lagoon(pingTimeout);
/* Node */
const lagoon = new Lagoon(pingTimeout, resourceLimits);
```

`resourceLimits` are passed directly to Node worker.

`pingTimeout` is the interval, in milliseconds, used to check whether the isolated environment is still responsive.

If the environment stops responding, for example because of an infinite loop, Lagoon destroys and recreates it.

After recreation, the sandbox receives the latest state known to the main process.

---

## State

Lagoon provides a synchronized state object.

### Main environment

```ts
const lagoon = new Lagoon();

lagoon.state.set("dot.separated.namespace", someValue);

const value = lagoon.state.get("dot.separated.namespace");
```

### Isolated environment

Inside sandboxed code, Lagoon is available as a global object:

```ts
Lagoon.state.set("dot.separated.namespace", someValue);

const value = Lagoon.state.get("dot.separated.namespace");
```

State paths use dot-separated names.

Each path node may contain its own value, so both of these can exist at the same time:

```ts
lagoon.state.set("root.firstHop", "value A");
lagoon.state.set("root.firstHop.secondHop", "value B");
```

### Forced synchronization

In the main environment, you can force synchronization manually:

```ts
lagoon.sync();
```

---

## Main Environment API

These methods are only available from the main environment.

---

### `lagoon.execute(code, args, timeout?)`

```ts
await lagoon.execute(code, args, timeout);
```

Executes code inside the isolated environment.

The executed code receives:

- global `Lagoon` object;
- local `args` variable.

Example:

```ts
await lagoon.execute(`
  const current = Lagoon.state.get("counter") ?? 0;
  Lagoon.state.set("counter", current + args.step);
`, {
  step: 1,
});
```

#### Signature

```ts
lagoon.execute(
  code: string,
  args: Record<string, any>,
  timeout?: number
): Promise<void>
```

If the executed function throws an error, the returned promise is rejected.

If `timeout` is greater than zero and the function does not finish in time, execution is considered failed, the promise is rejected, and state changes are not applied.

---

### `lagoon.registerFunction(name, code)`

```ts
await lagoon.registerFunction("increment", `
  const current = Lagoon.state.get("counter") ?? 0;
  Lagoon.state.set("counter", current + args.step);
`);
```

Compiles and stores a function inside the isolated environment.

Use this when the same function needs to be executed many times.

#### Signature

```ts
lagoon.registerFunction(
  name: string,
  code: string
): Promise<void>
```

If compilation fails, the returned promise is rejected.

---

### `lagoon.run(name, args, timeout?)`

```ts
await lagoon.run("increment", {
  step: 1,
});
```

Runs a previously registered function.

#### Signature

```ts
lagoon.run(
  name: string,
  args: Record<string, any>,
  timeout?: number
): Promise<void>
```

If the function throws, times out, or cannot be executed, the returned promise is rejected and state changes are not applied.

---

### `lagoon.runMany(list, policy?, timeout?)`

```ts
const errors = await lagoon.runMany([
  {
    name: "increment",
    args: { step: 1 },
  },
  {
    name: "updateScore",
    args: { value: 10 },
  },
], "strict", 1000);

console.log(`Batch execution errors: ${errors.join('\n')}`)
```

Runs several previously registered functions in one transaction.

Functions are executed in order. State changes are committed only after the whole batch finishes successfully.

If execution fails, all state changes from the batch are reverted.

`policy` may be `"strict"` or `"loose"`.

- `"strict"` is the default policy. Execution stops after the first function that throws an error, and the whole batch fails.
- `"loose"` continues executing the remaining functions even if one of them throws.

#### Signature

```ts
lagoon.runMany(
  list: Array<{
    name: string;
    args: Record<string, any>;
  }>,
  policy: "strict" | "loose" = "strict",
  timeout?: number
): Promise<void>
```

If the batch fails, times out, or cannot be executed, the returned promise is rejected.

---

## State Listeners

### `lagoon.state.addFieldListener(fieldName, listener)`

```ts
lagoon.state.addFieldListener("player.health", (newValue, oldValue) => {
  console.log("Health changed:", oldValue, "→", newValue);
});
```

Adds a listener for a specific state field.

Works only in the main environment.

### `lagoon.state.removeFieldListener(fieldName, listener)`

```ts
lagoon.state.removeFieldListener("player.health", listener);
```

Removes a previously registered listener.

### Listener signature

```ts
type FieldListener = (newValue: any, oldValue: any) => void;
```

---

## Shared API

These APIs are available both in the main environment and inside the isolated environment.

---

### `lagoon.ship(name, payload, timeout = 0, callback?)`

`ship` is an additional communication channel that is independent from the main execution chain.

It can be used to request data, call controlled host-side services, or send messages between the main and isolated environments.

#### Promise style

Inside the isolated environment:

```ts
const response = await Lagoon.ship("getSomeAsyncData", {
  id: args.id,
});
```

When used with `await`, function execution pauses until a response is received.

#### Callback style

```ts
Lagoon.ship("makeSomeLongRequest", { id }, (response: any) => {
  if (response.error) {
  	// handle error
  } else {
  	// handle response.data
  }
});
```

The callback version does not block the current function.

The callback is added to the execution queue and will run later as a regular queued function with the current synchronized state.

#### Signature

```ts
lagoon.ship(
  name: string,
  payload: any,
  callback?: (response: any) => void,
  timeout?: number
): Promise<any> 
```

---

### `lagoon.setShipListener(name, listener)`

Registers a handler for a `ship` message.

When the other side calls `ship(name, payload)`, Lagoon invokes the listener registered for that `name`.  
The value returned from the listener is used as the response payload for the caller.

The listener may be synchronous or asynchronous.

```ts
lagoon.setShipListener("getItemById", async (payload) => {
  return await getItem(payload.id);
});
```

#### Signature

```ts
lagoon.setShipListener(
  name: string,
  listener: ((data: any) => any | Promise<any>) | null
): void
```

Passing null removes the previously registered listener:

```ts
lagoon.setShipListener("getItemById", null);
```

If a listener with the same name already exists, it is overwritten.

If the listener throws or returns a rejected promise, the ship call on the other side will receive following structure:

```ts
{
	error: true,
	details: "error message"
}
```

---

## Execution Rules

Lagoon follows several important rules:

1. The main environment is always authoritative.
2. Sandboxed functions execute sequentially.
3. State changes are committed only after successful execution.
4. If execution fails, times out, or the sandbox is recreated, local changes are discarded.
5. If the main environment and sandbox modify the same state in parallel, the main environment wins.
6. `ship` callbacks are queued and executed with the latest available state.

---

## Example: Register and Run a Function

```ts
import Lagoon from "@tripod311/lagoon/node";

const lagoon = new Lagoon(
  500,
  {
    maxOldGenerationSizeMb: 64,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4,
  },
);

await lagoon.registerFunction("damagePlayer", `
  const hp = Lagoon.state.get("player.hp") ?? 100;
  Lagoon.state.set("player.hp", Math.max(0, hp - args.damage));
`);

lagoon.state.set("player.hp", 100);

try {
  await lagoon.run("damagePlayer", {
    damage: 25,
  });

  console.log(lagoon.state.get("player.hp")); // 75
} catch (err: any) {
  console.log(`Execution error: ${err.toString()}`);
}
```

---

## Example: Requesting Data with `ship`

```ts
await lagoon.execute(`
  const item = await Lagoon.ship("getItemById", {
    id: args.itemId,
  });

  Lagoon.state.set("selectedItem", item);
`, {
  itemId: "sword_001",
});
```

The host application decides what `getItemById` means and what data can be returned.

This makes `ship` a controlled capability channel: sandboxed code can only request operations that the host explicitly supports.

---

## When to Use Lagoon

Use Lagoon when you need to run code that should not be trusted with direct access to your application.

Good use cases:

- plugin systems;
- modding tools;
- browser-based scripting;
- server-side user scripts;
- generated code execution;
- rule engines;
- simulations;
- game logic extensions;
- controlled automation.

---

## When Not to Use Lagoon

Lagoon is not a replacement for:

- OS-level sandboxing;
- containers;
- virtual machines;
- permissioned serverless runtimes;
- dedicated security isolation for highly hostile code.

For extremely sensitive workloads, use Lagoon together with stronger process, container, VM, or infrastructure-level isolation.

---

## License

MIT
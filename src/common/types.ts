export interface LagoonOptions {
	pingTimeout?: number;
}

export interface ExecutionResult {
	error: boolean;
	details?: string;
	data?: any;
}

export type SendFunction = (command: string, data: any, timeout?: number) => Promise<ExecutionResult>

export {};
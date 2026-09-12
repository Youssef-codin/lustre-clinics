// The one entry point. Screens import from `../api`, never from a file inside it.

export { ApiProvider, useTRPC } from './ApiProvider';
export { api, trpcClient } from './client';
export type { ServerAddresses } from './config';
export { serverAddresses, setServerAddresses } from './config';
export type { AddressKind, ConnectionState, ConnectionStatus } from './connection';
export { getConnectionState, reprobe } from './connection';
export { dataGeneration, subscribeToDataReset } from './dataReset';
export type { DemoMode } from './demo';
export { enableDemoMode, resetDemoData, useDemoMode } from './demo';
export type { ApiFailure, FailureKind } from './errors';
export { classifyError, errorCodeOf, isOffline, isSlotOverlap } from './errors';
export type { RouterInput, RouterOutput } from './types';
export type { Connection } from './useConnection';
export { useConnection } from './useConnection';

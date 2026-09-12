// The one entry point. Screens import from `../api`, never from a file inside it.

export { ApiProvider, useTRPC } from './ApiProvider';
export { api, trpcClient } from './client';
export type { ServerAddresses } from './config';
export { serverAddresses, setServerAddresses } from './config';
export type { AddressKind, ConnectionStatus } from './connection';
export { getConnectionState, reprobe } from './connection';
export { dataGeneration, subscribeToDataReset } from './dataReset';
export { enableDemoMode, resetDemoData, useDemoMode } from './demo';
export { classifyError, errorCodeOf, isOffline, isSlotOverlap } from './errors';
export type { RouterOutput } from './types';
export { useConnection } from './useConnection';

/**
 * Offline Handling Utilities
 *
 * Network status detection, operation queueing, and optimistic UI support
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const PENDING_OPERATIONS_KEY = '@tailoredtime:pending_operations';
const LAST_SYNC_KEY = '@tailoredtime:last_sync';

// Operation types that can be queued
export type OperationType =
  | 'create_task'
  | 'update_task'
  | 'delete_task'
  | 'complete_task';

export interface PendingOperation {
  id: string;
  type: OperationType;
  payload: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

/**
 * Check if device is currently connected to the internet
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

/**
 * Subscribe to network status changes
 */
export function subscribeToNetworkStatus(
  callback: (isConnected: boolean) => void
): () => void {
  return NetInfo.addEventListener((state: NetInfoState) => {
    const isConnected = state.isConnected === true && state.isInternetReachable !== false;
    callback(isConnected);
  });
}

/**
 * Queue an operation for later execution when back online
 */
export async function queueOperation(
  type: OperationType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const operations = await getPendingOperations();

    const newOperation: PendingOperation = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
    };

    operations.push(newOperation);
    await AsyncStorage.setItem(PENDING_OPERATIONS_KEY, JSON.stringify(operations));

    console.log(`[Offline] Queued operation: ${type}`);
  } catch (error) {
    console.error('[Offline] Failed to queue operation:', error);
  }
}

/**
 * Get all pending operations
 */
export async function getPendingOperations(): Promise<PendingOperation[]> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_OPERATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[Offline] Failed to get pending operations:', error);
    return [];
  }
}

/**
 * Remove a pending operation after successful execution
 */
export async function removePendingOperation(operationId: string): Promise<void> {
  try {
    const operations = await getPendingOperations();
    const filtered = operations.filter(op => op.id !== operationId);
    await AsyncStorage.setItem(PENDING_OPERATIONS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('[Offline] Failed to remove pending operation:', error);
  }
}

/**
 * Update retry count for a failed operation
 */
export async function updateOperationRetry(operationId: string): Promise<void> {
  try {
    const operations = await getPendingOperations();
    const updated = operations.map(op => {
      if (op.id === operationId) {
        return { ...op, retries: op.retries + 1 };
      }
      return op;
    });
    await AsyncStorage.setItem(PENDING_OPERATIONS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[Offline] Failed to update operation retry:', error);
  }
}

/**
 * Clear operations that have exceeded max retries
 */
export async function clearFailedOperations(maxRetries: number = 5): Promise<number> {
  try {
    const operations = await getPendingOperations();
    const valid = operations.filter(op => op.retries < maxRetries);
    const removed = operations.length - valid.length;

    if (removed > 0) {
      await AsyncStorage.setItem(PENDING_OPERATIONS_KEY, JSON.stringify(valid));
      console.log(`[Offline] Cleared ${removed} failed operations`);
    }

    return removed;
  } catch (error) {
    console.error('[Offline] Failed to clear failed operations:', error);
    return 0;
  }
}

/**
 * Get pending operation count
 */
export async function getPendingOperationCount(): Promise<number> {
  const operations = await getPendingOperations();
  return operations.length;
}

/**
 * Save last successful sync timestamp
 */
export async function saveLastSyncTime(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
  } catch (error) {
    console.error('[Offline] Failed to save last sync time:', error);
  }
}

/**
 * Get last successful sync timestamp
 */
export async function getLastSyncTime(): Promise<number | null> {
  try {
    const stored = await AsyncStorage.getItem(LAST_SYNC_KEY);
    return stored ? parseInt(stored, 10) : null;
  } catch (error) {
    console.error('[Offline] Failed to get last sync time:', error);
    return null;
  }
}

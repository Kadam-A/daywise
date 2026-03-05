/**
 * Network Context
 *
 * Provides network status throughout the app with offline banner support
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { subscribeToNetworkStatus, isOnline, getPendingOperationCount } from '@/lib/offline';
import { processPendingOperations } from '@/lib/sync';

interface NetworkContextValue {
  isConnected: boolean;
  isChecking: boolean;
  pendingOperations: number;
  refreshStatus: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue>({
  isConnected: true,
  isChecking: true,
  pendingOperations: 0,
  refreshStatus: async () => {},
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(true);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const wasOffline = useRef(false);

  const syncPendingOperations = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await processPendingOperations();
      console.log(`[NetworkContext] Sync complete: ${result.success} success, ${result.failed} failed`);

      // Update pending count after sync
      const pendingCount = await getPendingOperationCount();
      setPendingOperations(pendingCount);
    } catch (error) {
      console.error('[NetworkContext] Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const refreshStatus = useCallback(async () => {
    try {
      const online = await isOnline();
      setIsConnected(online);

      const pendingCount = await getPendingOperationCount();
      setPendingOperations(pendingCount);
    } catch (error) {
      console.error('[NetworkContext] Error refreshing status:', error);
    }
  }, []);

  useEffect(() => {
    // Initial check
    const initializeNetworkStatus = async () => {
      const online = await isOnline();
      setIsConnected(online);
      setIsChecking(false);
      wasOffline.current = !online;

      const pendingCount = await getPendingOperationCount();
      setPendingOperations(pendingCount);

      // If online and have pending operations, sync them
      if (online && pendingCount > 0) {
        syncPendingOperations();
      }
    };

    initializeNetworkStatus();

    // Subscribe to changes
    const unsubscribe = subscribeToNetworkStatus((connected) => {
      const wasOfflineBefore = wasOffline.current;
      setIsConnected(connected);
      wasOffline.current = !connected;

      // When coming back online after being offline, sync pending operations
      if (connected && wasOfflineBefore) {
        console.log('[NetworkContext] Back online, syncing pending operations...');
        syncPendingOperations();
      }
    });

    return unsubscribe;
  }, [syncPendingOperations]);

  return (
    <NetworkContext.Provider
      value={{
        isConnected,
        isChecking,
        pendingOperations,
        refreshStatus,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}

/**
 * Sync Service
 *
 * Processes queued operations when device comes back online
 */

import { supabase } from './supabase';
import {
  getPendingOperations,
  removePendingOperation,
  updateOperationRetry,
  clearFailedOperations,
  saveLastSyncTime,
  PendingOperation,
} from './offline';

const MAX_RETRIES = 5;

/**
 * Consolidate duplicate update_task operations for the same task.
 * "Latest wins": later updates override earlier ones; intermediate ops are superseded.
 * Non-update ops (create, delete, complete) are passed through unchanged.
 */
function consolidateOperations(ops: PendingOperation[]): {
  toProcess: PendingOperation[];
  supersededIds: string[];
} {
  const result: PendingOperation[] = [];
  const supersededIds: string[] = [];
  const updateGroups = new Map<string, PendingOperation[]>();

  for (const op of ops) {
    if (op.type === 'update_task') {
      const taskId = (op.payload as { taskId: string }).taskId;
      const group = updateGroups.get(taskId) ?? [];
      group.push(op);
      updateGroups.set(taskId, group);
    } else {
      result.push(op);
    }
  }

  for (const [, group] of updateGroups) {
    const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp);
    const last = sorted[sorted.length - 1];

    // Merge all payloads in chronological order; later values override earlier ones
    const mergedPayload = sorted.reduce(
      (payload, op) => ({ ...payload, ...op.payload }),
      {} as Record<string, unknown>
    );

    // Use the last op's id and retries so superseded entries are all prior ops
    const merged: PendingOperation = { ...last, payload: mergedPayload };

    result.push(merged);
    if (sorted.length > 1) {
      supersededIds.push(...sorted.slice(0, -1).map(op => op.id));
    }
  }

  return { toProcess: result, supersededIds };
}

/**
 * Process all pending operations
 */
export async function processPendingOperations(): Promise<{
  success: number;
  failed: number;
}> {
  const operations = await getPendingOperations();

  if (operations.length === 0) {
    return { success: 0, failed: 0 };
  }

  // Consolidate duplicate update_task ops before processing
  const { toProcess, supersededIds } = consolidateOperations(operations);

  // Remove superseded ops (they are absorbed into the merged op)
  for (const id of supersededIds) {
    await removePendingOperation(id);
  }

  console.log(`[Sync] Processing ${toProcess.length} pending operations`);

  let success = 0;
  let failed = 0;

  for (const operation of toProcess) {
    try {
      await processOperation(operation);
      await removePendingOperation(operation.id);
      success++;
      console.log(`[Sync] Successfully processed: ${operation.type}`);
    } catch (error) {
      console.error(`[Sync] Failed to process ${operation.type}:`, error);

      if (operation.retries >= MAX_RETRIES - 1) {
        // Max retries exceeded, will be cleaned up
        failed++;
      } else {
        await updateOperationRetry(operation.id);
      }
    }
  }

  // Clean up operations that exceeded max retries
  await clearFailedOperations(MAX_RETRIES);

  // Save successful sync time
  if (success > 0) {
    await saveLastSyncTime();
  }

  console.log(`[Sync] Completed: ${success} success, ${failed} failed`);
  return { success, failed };
}

/**
 * Process a single operation
 */
async function processOperation(operation: PendingOperation): Promise<void> {
  switch (operation.type) {
    case 'complete_task':
      await processCompleteTask(operation.payload);
      break;

    case 'create_task':
      await processCreateTask(operation.payload);
      break;

    case 'update_task':
      await processUpdateTask(operation.payload);
      break;

    case 'delete_task':
      await processDeleteTask(operation.payload);
      break;

    default:
      console.warn(`[Sync] Unknown operation type: ${operation.type}`);
  }
}

async function processCompleteTask(payload: Record<string, unknown>): Promise<void> {
  const { taskId } = payload as { taskId: string };

  const { error } = await supabase
    .from('tasks')
    .update({ status: 'completed' })
    .eq('id', taskId);

  if (error) throw error;
}

async function processCreateTask(payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('tasks').insert(payload);
  if (error) throw error;
}

async function processUpdateTask(payload: Record<string, unknown>): Promise<void> {
  const { taskId, ...updates } = payload as { taskId: string; [key: string]: unknown };

  const { error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId);

  if (error) throw error;
}

async function processDeleteTask(payload: Record<string, unknown>): Promise<void> {
  const { taskId } = payload as { taskId: string };

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) throw error;
}

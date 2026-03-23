import { useState, useRef, useCallback } from 'react';

interface HistoryState {
  layerId: string;
  imageData: ImageData;
}

/**
 * Two-stack undo/redo system.
 *
 * saveState(layerId, imageData) — called BEFORE each edit with the layer's
 *   current pixel data.  Pushes to the undo stack and clears the redo stack
 *   (a new edit invalidates any redo history).
 *
 * undo(currentLayerId, currentImageData) — caller passes the CURRENT canvas
 *   state of the target layer so it can be pushed onto the redo stack, then
 *   pops and returns the most recent undo entry for the caller to restore.
 *
 * redo(currentLayerId, currentImageData) — mirror of undo: pushes the current
 *   state onto the undo stack, then pops and returns the most recent redo entry.
 *
 * undoTargetLayerId() / redoTargetLayerId() — peek at which layer the next
 *   undo/redo operation will affect, so the caller can grab its imageData.
 */
export function useHistory(maxSize: number = 50) {
  const undoStackRef = useRef<HistoryState[]>([]);
  const redoStackRef = useRef<HistoryState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const saveState = useCallback((layerId: string, imageData: ImageData) => {
    undoStackRef.current.push({ layerId, imageData });
    // Trim to max size (drop oldest)
    if (undoStackRef.current.length > maxSize) {
      undoStackRef.current.shift();
    }
    // A new edit invalidates any redo history
    redoStackRef.current = [];
    syncFlags();
  }, [maxSize, syncFlags]);

  /** Which layer the next undo would affect (peek without popping). */
  const undoTargetLayerId = useCallback((): string | null => {
    const s = undoStackRef.current;
    return s.length > 0 ? s[s.length - 1].layerId : null;
  }, []);

  /** Which layer the next redo would affect (peek without popping). */
  const redoTargetLayerId = useCallback((): string | null => {
    const s = redoStackRef.current;
    return s.length > 0 ? s[s.length - 1].layerId : null;
  }, []);

  const undo = useCallback((currentLayerId: string, currentImageData: ImageData): HistoryState | null => {
    if (undoStackRef.current.length === 0) return null;
    // Save current state so redo can restore it
    redoStackRef.current.push({ layerId: currentLayerId, imageData: currentImageData });
    const state = undoStackRef.current.pop()!;
    syncFlags();
    return state;
  }, [syncFlags]);

  const redo = useCallback((currentLayerId: string, currentImageData: ImageData): HistoryState | null => {
    if (redoStackRef.current.length === 0) return null;
    // Save current state so undo can get back here
    undoStackRef.current.push({ layerId: currentLayerId, imageData: currentImageData });
    const state = redoStackRef.current.pop()!;
    syncFlags();
    return state;
  }, [syncFlags]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncFlags();
  }, [syncFlags]);

  return {
    undo,
    redo,
    saveState,
    clear,
    canUndo,
    canRedo,
    undoTargetLayerId,
    redoTargetLayerId,
  };
}

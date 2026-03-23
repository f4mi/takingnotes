import { useState, useRef, useCallback } from 'react';
import type { Stroke, Point } from '@/types';

interface RecordingSession {
  strokes: Stroke[];
  startTime: number;
  isRecording: boolean;
}

export function useAnimationRecorder() {
  const [recordedStrokes, setRecordedStrokes] = useState<Stroke[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const sessionRef = useRef<RecordingSession>({
    strokes: [],
    startTime: 0,
    isRecording: false
  });

  const startRecording = useCallback(() => {
    sessionRef.current = {
      strokes: [],
      startTime: Date.now(),
      isRecording: true
    };
    setIsRecording(true);
    setRecordedStrokes([]);
  }, []);

  const stopRecording = useCallback(() => {
    sessionRef.current.isRecording = false;
    setIsRecording(false);
    return sessionRef.current.strokes;
  }, []);

  const addStroke = useCallback((stroke: Stroke) => {
    if (!sessionRef.current.isRecording) return;
    
    // Adjust timestamps relative to recording start
    const adjustedStroke: Stroke = {
      ...stroke,
      points: stroke.points.map(p => ({
        ...p,
        timestamp: p.timestamp - sessionRef.current.startTime
      }))
    };
    
    sessionRef.current.strokes.push(adjustedStroke);
    setRecordedStrokes(prev => [...prev, adjustedStroke]);
  }, []);

  const addPointToCurrentStroke = useCallback((point: Point) => {
    if (!sessionRef.current.isRecording) return;
    
    const currentStrokes = sessionRef.current.strokes;
    if (currentStrokes.length === 0) return;
    
    const lastStroke = currentStrokes[currentStrokes.length - 1];
    lastStroke.points.push({
      ...point,
      timestamp: point.timestamp - sessionRef.current.startTime
    });
    
    setRecordedStrokes([...currentStrokes]);
  }, []);

  const clearRecordings = useCallback(() => {
    sessionRef.current.strokes = [];
    setRecordedStrokes([]);
  }, []);

  const getRecordingDuration = useCallback(() => {
    if (!sessionRef.current.isRecording) return 0;
    return Date.now() - sessionRef.current.startTime;
  }, []);

  const getStrokeAtTime = useCallback((timeMs: number): Stroke[] => {
    return sessionRef.current.strokes.filter(stroke => {
      const strokeStart = stroke.points[0]?.timestamp || 0;
      const strokeEnd = stroke.points[stroke.points.length - 1]?.timestamp || strokeStart;
      return strokeStart <= timeMs && strokeEnd >= timeMs;
    });
  }, []);

  const getStrokesUpToTime = useCallback((timeMs: number): Stroke[] => {
    return sessionRef.current.strokes.filter(stroke => {
      const strokeStart = stroke.points[0]?.timestamp || 0;
      return strokeStart <= timeMs;
    });
  }, []);

  return {
    recordedStrokes,
    isRecording,
    startRecording,
    stopRecording,
    addStroke,
    addPointToCurrentStroke,
    clearRecordings,
    getRecordingDuration,
    getStrokeAtTime,
    getStrokesUpToTime
  };
}

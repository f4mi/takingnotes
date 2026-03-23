import { useState, useRef, useCallback, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import type {
  DownloadedMemoryNotebook,
  DownloadedMemoryPage,
  DownloadedMemoryStroke,
  TabletBackendCapabilities,
  TabletDeviceCapabilities,
  TabletDeviceType,
  TabletInputMode,
} from '@/types/memory';
import { HuionNoteBLE, type HuionPenPoint } from '@/utils/huionBLE';
import { HuionTabletUSB, type HuionUSBPenPoint } from '@/utils/tabletUSB';
import { WacomSmartPadBLE, type WacomLiveOrientation, type WacomPenPoint } from '@/utils/wacomBLE';

const WACOM_UUID_STORAGE_KEY = 'takingnotes_wacom_uuid';

interface TabletPanelProps {
  canvasWidth: number;
  canvasHeight: number;
  onPenPoint: (x: number, y: number, pressure: number, isDown: boolean) => void;
  onDeviceConnected?: (
    deviceType: TabletDeviceType,
    deviceWidth: number,
    deviceHeight: number,
    deviceName: string,
    mode?: TabletInputMode | null,
    preferredOrientation?: 'portrait' | 'landscape' | null,
  ) => void;
  onNewPage?: () => void;
  onStreamingChange?: (streaming: boolean) => void;
  onConnectionStateChange?: (connected: boolean) => void;
  onPagesDownloaded?: (notebook: DownloadedMemoryNotebook) => void;
  onOpenMemoryPage?: () => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'streaming' | 'downloading';
type LiveInputPreset = 'normal' | 'tablet';

type DownloadablePage = {
  pageNum?: number;
  timestamp?: number;
  strokes?: DownloadedMemoryStroke[];
};

type ConnectionTransport = 'ble' | 'usb';

function sanitizeHex12(value: string) {
  return value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 12);
}

function loadStoredWacomUuid() {
  if (typeof window === 'undefined') {
    return '';
  }
  return sanitizeHex12(window.localStorage.getItem(WACOM_UUID_STORAGE_KEY) || '');
}

function persistWacomUuid(value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  const sanitized = sanitizeHex12(value);
  if (sanitized) {
    window.localStorage.setItem(WACOM_UUID_STORAGE_KEY, sanitized);
    return;
  }
  window.localStorage.removeItem(WACOM_UUID_STORAGE_KEY);
}

function getBackendCapabilities(backend: TabletBackendCapabilities | null | undefined): TabletDeviceCapabilities | null {
  return backend?.capabilities ?? null;
}

function getWacomCanvasSize(device: WacomSmartPadBLE, orientation: WacomLiveOrientation) {
  const width = Math.round(device.config.width / device.config.pointSize);
  const height = Math.round(device.config.height / device.config.pointSize);
  return orientation.includes('landscape')
    ? { width, height }
    : { width: height, height: width };
}

function resolveWacomBackendOrientation(orientation: WacomLiveOrientation): WacomLiveOrientation {
  if (orientation === 'landscape') {
    return 'reverse-landscape';
  }
  if (orientation === 'reverse-landscape') {
    return 'landscape';
  }
  return orientation;
}

export function TabletPanel({
  canvasWidth,
  canvasHeight,
  onPenPoint,
  onDeviceConnected,
  onNewPage,
  onStreamingChange,
  onConnectionStateChange,
  onPagesDownloaded,
  onOpenMemoryPage,
}: TabletPanelProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusText, setStatusText] = useState('No device');
  const [log, setLog] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [pressureSensitivity, setPressureSensitivity] = useState(100);
  const [huionInputMode, setHuionInputMode] = useState<LiveInputPreset>('tablet');
  const [wacomOrientation, setWacomOrientation] = useState<WacomLiveOrientation>('landscape');
  const [activeDeviceType, setActiveDeviceType] = useState<TabletDeviceType | null>(null);
  const [activeTransport, setActiveTransport] = useState<ConnectionTransport | null>(null);
  const [deviceCapabilities, setDeviceCapabilities] = useState<TabletDeviceCapabilities | null>(null);
  const [activeInputMode, setActiveInputMode] = useState<TabletInputMode | null>(null);
  const [wacomUuid, setWacomUuid] = useState(loadStoredWacomUuid);
  const [showWacomSetup, setShowWacomSetup] = useState(false);

  const huionRef = useRef<HuionNoteBLE | null>(null);
  const huionUsbRef = useRef<HuionTabletUSB | null>(null);
  const wacomRef = useRef<WacomSmartPadBLE | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const onPenPointRef = useRef(onPenPoint);
  const onNewPageRef = useRef(onNewPage);
  const canvasWidthRef = useRef(canvasWidth);
  const canvasHeightRef = useRef(canvasHeight);
  const sensitivityRef = useRef(pressureSensitivity);
  const huionInputModeRef = useRef(huionInputMode);
  const wacomOrientationRef = useRef(wacomOrientation);
  const activeDeviceTypeRef = useRef<TabletDeviceType | null>(null);

  useEffect(() => {
    onPenPointRef.current = onPenPoint;
    onNewPageRef.current = onNewPage;
    canvasWidthRef.current = canvasWidth;
    canvasHeightRef.current = canvasHeight;
    sensitivityRef.current = pressureSensitivity;
    huionInputModeRef.current = huionInputMode;
    wacomOrientationRef.current = wacomOrientation;
    activeDeviceTypeRef.current = activeDeviceType;
  });

  const transformInputPoint = useCallback((x: number, y: number, mode: LiveInputPreset) => {
    if (mode === 'tablet') {
      return { x: y, y: 1 - x };
    }
    return { x, y };
  }, []);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-200), msg]);
  }, []);

  useEffect(() => {
    if (showLog) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log, showLog]);

  const syncStatusFromBackend = useCallback((nextStatus: string) => {
    setStatusText(nextStatus);
    if (/disconnected/i.test(nextStatus)) {
      setStatus('disconnected');
      setIsStreaming(false);
      onStreamingChange?.(false);
      onConnectionStateChange?.(false);
      return;
    }
    if (/download/i.test(nextStatus)) {
      setStatus('downloading');
      return;
    }
    if (/live|streaming/i.test(nextStatus)) {
      setStatus('streaming');
      return;
    }
    if (/connected|authenticated|registered/i.test(nextStatus)) {
      setStatus('connected');
    }
  }, [onConnectionStateChange, onStreamingChange]);

  const resetPanelState = useCallback(() => {
    setStatus('disconnected');
    setStatusText('No device');
    setIsStreaming(false);
    setDeviceName('');
    setPageCount(0);
    setActiveDeviceType(null);
    setActiveTransport(null);
    setDeviceCapabilities(null);
    setActiveInputMode(null);
    activeDeviceTypeRef.current = null;
    onStreamingChange?.(false);
    onConnectionStateChange?.(false);
  }, [onConnectionStateChange, onStreamingChange]);

  const disconnectBackends = useCallback(async () => {
    const huion = huionRef.current;
    const huionUsb = huionUsbRef.current;
    const wacom = wacomRef.current;
    huionRef.current = null;
    huionUsbRef.current = null;
    wacomRef.current = null;
    await Promise.allSettled([
      huion?.disconnect(),
      huionUsb?.disconnect(),
      wacom?.disconnect(),
    ]);
  }, []);

  const markBleLinkDropped = useCallback(() => {
    const activeName = deviceName || (activeDeviceTypeRef.current === 'wacom' ? 'Wacom/tUHI' : 'Huion');
    addLog(`${activeName} BLE link is disconnected. Reconnect the device.`);
    setStatus('disconnected');
    setStatusText('Disconnected');
    setIsStreaming(false);
    onStreamingChange?.(false);
    onConnectionStateChange?.(false);
  }, [addLog, deviceName, onConnectionStateChange, onStreamingChange]);

  const handleHuionPen = useCallback((point: HuionPenPoint) => {
    const mapped = transformInputPoint(point.x, point.y, huionInputModeRef.current);
    const sens = sensitivityRef.current / 100;
    onPenPointRef.current(
      mapped.x * canvasWidthRef.current,
      mapped.y * canvasHeightRef.current,
      Math.min(1, point.pressure * sens),
      point.status > 0,
    );
  }, [transformInputPoint]);

  const handleWacomPen = useCallback((point: WacomPenPoint) => {
    const sens = sensitivityRef.current / 100;
    onPenPointRef.current(
      point.x * canvasWidthRef.current,
      point.y * canvasHeightRef.current,
      Math.min(1, point.pressure * sens),
      point.status > 0,
    );
  }, []);

  const handleHuionUsbPen = useCallback((point: HuionUSBPenPoint) => {
    const mapped = transformInputPoint(point.x, point.y, huionInputModeRef.current);
    const sens = sensitivityRef.current / 100;
    onPenPointRef.current(
      mapped.x * canvasWidthRef.current,
      mapped.y * canvasHeightRef.current,
      Math.min(1, point.pressure * sens),
      point.status > 0,
    );
  }, [transformInputPoint]);

  useEffect(() => {
    wacomRef.current?.setLiveOrientation(resolveWacomBackendOrientation(wacomOrientation));
  }, [wacomOrientation]);

  useEffect(() => {
    return () => {
      void disconnectBackends();
    };
  }, [disconnectBackends]);

  const connectHuion = useCallback(async () => {
    if (status === 'connecting') {
      return;
    }
    try {
      setShowWacomSetup(false);
      await disconnectBackends();
      resetPanelState();
      setStatus('connecting');
      setStatusText('Scanning...');
      setShowLog(true);
      const huion = new HuionNoteBLE();
      huion.onLog = (msg) => { addLog(msg); console.log('[Huion BLE]', msg); };
      huion.onStatus = syncStatusFromBackend;
      huion.onPen = handleHuionPen;
      huion.onNextPage = () => {
        addLog('Notebook button: new page');
        onNewPageRef.current?.();
      };
      huionRef.current = huion;
      setActiveDeviceType('huion');
      setActiveTransport('ble');
      setDeviceCapabilities(getBackendCapabilities(huion));
      setActiveInputMode(null);
      activeDeviceTypeRef.current = 'huion';
      await huion.connect();
      setDeviceName(huion.deviceName);
      setStatus('connected');
      onConnectionStateChange?.(true);
      onDeviceConnected?.('huion', huion.config.pageWidth, huion.config.pageHeight, huion.deviceName, null, null);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`ERROR: ${e?.message ?? e}`);
      await disconnectBackends();
      resetPanelState();
      setStatusText('Failed');
      setTimeout(() => setStatusText('No device'), 3000);
    }
  }, [status, disconnectBackends, resetPanelState, addLog, syncStatusFromBackend, handleHuionPen, onConnectionStateChange, onDeviceConnected]);

  const connectHuionUsb = useCallback(async () => {
    if (status === 'connecting') {
      return;
    }
    try {
      setShowWacomSetup(false);
      await disconnectBackends();
      resetPanelState();
      setStatus('connecting');
      setStatusText('Pick USB tablet...');
      setShowLog(true);
      const huionUsb = new HuionTabletUSB();
      huionUsb.onLog = (msg) => { addLog(msg); console.log('[Huion USB]', msg); };
      huionUsb.onStatus = syncStatusFromBackend;
      huionUsb.onPen = handleHuionUsbPen;
      huionUsbRef.current = huionUsb;
      setActiveDeviceType('huion');
      setActiveTransport('usb');
      setDeviceCapabilities(getBackendCapabilities(huionUsb));
      setActiveInputMode(null);
      activeDeviceTypeRef.current = 'huion';
      await huionUsb.connect();
      setDeviceName(huionUsb.deviceName);
      setStatus('connected');
      onConnectionStateChange?.(true);
      onDeviceConnected?.('huion', huionUsb.config.pageWidth, huionUsb.config.pageHeight, huionUsb.deviceName, null, null);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`ERROR: ${e?.message ?? e}`);
      await disconnectBackends();
      resetPanelState();
      setStatusText('Failed');
      setTimeout(() => setStatusText('No device'), 3000);
    }
  }, [status, disconnectBackends, resetPanelState, addLog, syncStatusFromBackend, handleHuionUsbPen, onConnectionStateChange, onDeviceConnected]);

  const connectWacom = useCallback(async () => {
    if (status === 'connecting') {
      return;
    }

    const uuid = sanitizeHex12(wacomUuid);
    if (uuid.length !== 12) {
      setShowLog(true);
      addLog('Enter the registered 12-hex Wacom/tUHI UUID first, or click Register UUID.');
      setStatusText('Need Wacom/tUHI UUID');
      return;
    }

    try {
      setShowWacomSetup(false);
      await disconnectBackends();
      resetPanelState();
      setStatus('connecting');
      setStatusText('Scanning...');
      setShowLog(true);
      const wacom = new WacomSmartPadBLE();
      wacom.onLog = (msg) => { addLog(msg); console.log('[Wacom BLE]', msg); };
      wacom.onStatus = syncStatusFromBackend;
      wacom.onPen = handleWacomPen;
      wacom.setLiveOrientation(resolveWacomBackendOrientation(wacomOrientationRef.current));
      wacomRef.current = wacom;
      setActiveDeviceType('wacom');
      setActiveTransport('ble');
      setDeviceCapabilities(getBackendCapabilities(wacom));
      setActiveInputMode(null);
      activeDeviceTypeRef.current = 'wacom';
      await wacom.connect(uuid);
      persistWacomUuid(uuid);
      setWacomUuid(uuid);
      setDeviceName(wacom.deviceName);
      setStatus('connected');
      onConnectionStateChange?.(true);
      onDeviceConnected?.('wacom', wacom.config.pageWidth, wacom.config.pageHeight, wacom.deviceName, null, null);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`ERROR: ${e?.message ?? e}`);
      await disconnectBackends();
      resetPanelState();
      setStatusText('Failed');
      setTimeout(() => setStatusText('No device'), 3000);
    }
  }, [status, wacomUuid, disconnectBackends, resetPanelState, addLog, syncStatusFromBackend, handleWacomPen, onConnectionStateChange, onDeviceConnected]);

  const registerWacom = useCallback(async () => {
    if (status === 'connecting') {
      return;
    }

    try {
      await disconnectBackends();
      resetPanelState();
      setStatus('connecting');
      setStatusText('Registering...');
      setShowLog(true);
      const wacom = new WacomSmartPadBLE();
      wacom.onLog = (msg) => { addLog(msg); console.log('[Wacom BLE]', msg); };
      wacom.onStatus = syncStatusFromBackend;
      wacom.onPen = handleWacomPen;
      wacom.setLiveOrientation(resolveWacomBackendOrientation(wacomOrientationRef.current));
      wacomRef.current = wacom;
      setActiveDeviceType('wacom');
      setActiveTransport('ble');
      setDeviceCapabilities(getBackendCapabilities(wacom));
      setActiveInputMode(null);
      activeDeviceTypeRef.current = 'wacom';

      addLog('Register flow: put the Wacom notebook into registration mode first by holding the button until the blue LED blinks.');
      const uuid = await wacom.registerNewUuid();
      persistWacomUuid(uuid);
      setWacomUuid(uuid);
      addLog(`Saved Wacom/tUHI UUID ${uuid}. Click Connect to use it.`);
      await disconnectBackends();
      resetPanelState();
      setStatusText('UUID saved');
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`ERROR: ${e?.message ?? e}`);
      await disconnectBackends();
      resetPanelState();
      setStatusText('Failed');
      setTimeout(() => setStatusText('No device'), 3000);
    }
  }, [status, disconnectBackends, resetPanelState, addLog, syncStatusFromBackend, handleWacomPen]);

  const disconnect = useCallback(async () => {
    await disconnectBackends();
    resetPanelState();
  }, [disconnectBackends, resetPanelState]);

  const toggleStreaming = useCallback(async () => {
    try {
      if (activeTransport === 'usb') {
        const device = huionUsbRef.current;
        if (isStreaming) {
          await device?.stopStreaming();
          setIsStreaming(false);
          setActiveInputMode(null);
          setStatus('connected');
          setStatusText('Connected');
          onStreamingChange?.(false);
        } else {
          await device?.startStreaming();
          setIsStreaming(true);
          setActiveInputMode('tablet');
          setStatus('streaming');
          setStatusText('Live');
          onStreamingChange?.(true);
        }
        return;
      }

      if (activeDeviceTypeRef.current === 'wacom') {
        const device = wacomRef.current;
        if (device && !device.isConnected && !device.isStreaming) {
          markBleLinkDropped();
          return;
        }
        if (isStreaming) {
          await device?.stopStreaming();
          setIsStreaming(false);
          setActiveInputMode(null);
          setStatus('connected');
          setStatusText('Connected');
          onStreamingChange?.(false);
        } else {
          await device?.startStreaming();
          setIsStreaming(true);
          setActiveInputMode('tablet');
          setStatus('streaming');
          setStatusText('Live');
          onStreamingChange?.(true);
        }
        return;
      }

      const device = huionRef.current;
      if (device && !device.isConnected) {
        markBleLinkDropped();
        return;
      }
      if (isStreaming) {
        await device?.stopStreaming();
        setIsStreaming(false);
        setActiveInputMode(null);
        setStatus('connected');
        setStatusText('Connected');
        onStreamingChange?.(false);
      } else {
        await device?.startStreaming();
        setIsStreaming(true);
        setActiveInputMode('tablet');
        setStatus('streaming');
        setStatusText('Live');
        onStreamingChange?.(true);
      }
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`Stream error: ${e?.message ?? e}`);
      setStatus('connected');
      setStatusText('Connected');
      onStreamingChange?.(false);
    }
  }, [isStreaming, addLog, markBleLinkDropped, onStreamingChange]);

  const saveDownloadedNotebook = useCallback((
    pages: DownloadablePage[],
    notebookUuid: string,
    resolvedType: TabletDeviceType,
    resolvedName: string,
    pageWidth: number,
    pageHeight: number,
  ) => {
    const downloadTime = Date.now();
    const notebook: DownloadedMemoryNotebook = {
      id: `${resolvedType}-${downloadTime}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: notebookUuid,
      notebookUuid,
      deviceType: resolvedType,
      deviceName: resolvedName,
      notebookName: resolvedName,
      downloadedAt: downloadTime,
      pageWidth,
      pageHeight,
      pageCount: pages.length,
      pages: pages.map((page, index): DownloadedMemoryPage => ({
        id: `${resolvedType}-page-${downloadTime}-${index}`,
        pageNum: typeof page.pageNum === 'number' ? page.pageNum : index,
        strokeCount: Array.isArray(page.strokes) ? page.strokes.length : 0,
        pointCount: Array.isArray(page.strokes)
          ? page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0)
          : 0,
        timestamp: typeof page.timestamp === 'number' ? page.timestamp : downloadTime,
        strokes: Array.isArray(page.strokes)
          ? page.strokes.map((stroke) => ({
              points: Array.isArray(stroke.points)
                ? stroke.points.map((point) => ({
                    x: point.x,
                    y: point.y,
                    pressure: point.pressure,
                  }))
                : [],
            }))
          : [],
      })),
    };

    onPagesDownloaded?.(notebook);
    addLog(`Downloaded ${notebook.pageCount} page${notebook.pageCount > 1 ? 's' : ''} from ${resolvedName} into Notebook Downloads`);
    onOpenMemoryPage?.();
  }, [addLog, onOpenMemoryPage, onPagesDownloaded]);

  const downloadHuionPages = useCallback(async () => {
    try {
      setStatus('downloading');
      setStatusText('Downloading...');
      setActiveInputMode('paper');

      const pages = await (huionRef.current?.downloadPages() ?? Promise.resolve([]));
      setPageCount(pages.length);
      if (pages.length === 0) {
        addLog('No stored pages found on the Huion notebook');
        setStatus('connected');
        setStatusText('Connected');
        setActiveInputMode(null);
        return;
      }

      saveDownloadedNotebook(
        pages,
        huionRef.current?.notebookUuid || `huion:${deviceName || 'note'}`,
        'huion',
        deviceName || 'Huion Note',
        huionRef.current?.config.pageWidth || canvasWidthRef.current,
        huionRef.current?.config.pageHeight || canvasHeightRef.current,
      );
      setStatus('connected');
      setStatusText('Connected');
      setActiveInputMode(null);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`Download error: ${e?.message ?? e}`);
      setStatus('connected');
      setStatusText('Connected');
      setActiveInputMode(null);
    }
  }, [deviceName, addLog, saveDownloadedNotebook]);

  const downloadWacomPages = useCallback(async () => {
    try {
      setStatus('downloading');
      setStatusText('Downloading...');
      setActiveInputMode('paper');

      const pages = await (wacomRef.current?.downloadPages() ?? Promise.resolve([]));
      setPageCount(pages.length);
      if (pages.length === 0) {
        addLog('No stored pages found on the Wacom/tUHI notebook');
        setStatus('connected');
        setStatusText('Connected');
        setActiveInputMode(null);
        return;
      }

      saveDownloadedNotebook(
        pages,
        wacomRef.current?.notebookUuid || `wacom:${sanitizeHex12(wacomUuid) || deviceName || 'smartpad'}`,
        'wacom',
        deviceName || 'Wacom/tUHI Notebook',
        wacomRef.current?.config.pageWidth || canvasWidthRef.current,
        wacomRef.current?.config.pageHeight || canvasHeightRef.current,
      );
      setStatus('connected');
      setStatusText('Connected');
      setActiveInputMode(null);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      addLog(`Download error: ${e?.message ?? e}`);
      setStatus('connected');
      setStatusText('Connected');
      setActiveInputMode(null);
    }
  }, [deviceName, wacomUuid, addLog, saveDownloadedNotebook]);

  const requestCanvasMatch = useCallback(() => {
    if (!onDeviceConnected) {
      return;
    }

    if (activeDeviceTypeRef.current === 'wacom' && wacomRef.current) {
      const canvas = getWacomCanvasSize(wacomRef.current, wacomOrientation);
      onDeviceConnected(
        'wacom',
        canvas.width,
        canvas.height,
        wacomRef.current.deviceName,
        activeInputMode === 'paper' ? 'paper' : 'tablet',
        activeInputMode === 'paper' ? 'portrait' : (wacomOrientation.includes('portrait') ? 'portrait' : 'landscape'),
      );
      return;
    }

    if (activeDeviceTypeRef.current === 'huion' && huionRef.current) {
      onDeviceConnected(
        'huion',
        huionRef.current.config.pageWidth,
        huionRef.current.config.pageHeight,
        huionRef.current.deviceName,
        activeInputMode === 'paper' ? 'paper' : 'tablet',
        null,
      );
      return;
    }

    if (activeDeviceTypeRef.current === 'huion' && huionUsbRef.current) {
      onDeviceConnected(
        'huion',
        huionUsbRef.current.config.pageWidth,
        huionUsbRef.current.config.pageHeight,
        huionUsbRef.current.deviceName,
        'tablet',
        null,
      );
    }
  }, [activeInputMode, onDeviceConnected, wacomOrientation]);

  const hasBLE = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const hasHID = typeof navigator !== 'undefined' && 'hid' in navigator;
  const sanitizedWacomUuid = sanitizeHex12(wacomUuid);
  const dotColor = {
    disconnected: '#666',
    connecting: '#d4a024',
    connected: '#3b9',
    streaming: '#47f',
    downloading: '#d4a024',
  }[status];
  const deviceTypeLabel = activeDeviceType === 'wacom'
    ? 'Wacom/tUHI BLE'
    : activeTransport === 'usb'
      ? 'Huion USB HID'
      : 'Huion BLE';
  const streamingLabel = activeDeviceType === 'wacom'
    ? 'Plastic nib / tablet mode on Wacom/tUHI via BLE -> canvas'
    : activeTransport === 'usb'
      ? 'Plastic nib / tablet mode on Huion via USB HID -> canvas'
      : 'Plastic nib / tablet mode on Huion via BLE -> canvas';
  const capabilityLabel = deviceCapabilities
    ? [
        deviceCapabilities.paper ? 'paper' : null,
        deviceCapabilities.tablet ? 'tablet' : null,
      ].filter(Boolean).join(' + ')
    : '';
  const activeModeLabel = activeInputMode === 'paper'
    ? 'Paper import'
    : activeInputMode === 'tablet'
      ? 'Tablet input'
      : 'Idle';
  const liveModeLabel = activeDeviceType === 'wacom'
    ? formatWacomOrientationLabel(wacomOrientation)
    : activeDeviceType === 'huion'
      ? (huionInputMode === 'tablet' ? 'Tablet mode' : 'Normal mode')
      : null;
  const isWacomFlow = activeDeviceType === 'wacom' || showWacomSetup;
  const pairingInstruction = (() => {
    if (!isWacomFlow) return null;

    if (status === 'connecting') {
      if (/register/i.test(statusText)) {
        return {
          tone: 'amber' as const,
          title: 'Wacom/tUHI registration in progress',
          body: 'If the blue LED is not already blinking, hold the notebook button until it blinks. After Chrome shows the device, press the button once to confirm registration.',
        };
      }
      if (/scan|connect/i.test(statusText)) {
        return {
          tone: 'blue' as const,
          title: 'Connecting to Wacom notebook',
          body: 'Choose the Wacom device in Chrome. If the notebook wakes up but does not finish connecting, press the button once.',
        };
      }
    }

    if (status === 'connected' && activeDeviceType === 'wacom') {
      return {
        tone: 'green' as const,
        title: 'Wacom/tUHI ready',
        body: 'The notebook is paired in this browser. Use Connect next time unless you factory-reset the device.',
      };
    }

    if (showWacomSetup) {
      return {
        tone: 'amber' as const,
        title: 'First-time Wacom/tUHI setup',
        body: '1. Hold the notebook button until the blue LED blinks. 2. Click Register UUID. 3. Pick the device in Chrome. 4. Press the button once when prompted.',
      };
    }

    return null;
  })();

  return (
    <div className="select-none space-y-0 text-xs">
      <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'linear-gradient(180deg, rgba(58,58,58,0.96) 0%, rgba(34,34,34,0.96) 100%)', border: '1px solid #474747', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}>
        <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor, boxShadow: status === 'streaming' ? `0 0 6px ${dotColor}` : 'none' }} />
        <span className="flex-1 truncate text-neutral-200" style={{ fontSize: 12, fontWeight: 600 }}>{deviceName || statusText}</span>
        {deviceName && <span className="text-neutral-500" style={{ fontSize: 10.5 }}>{statusText}</span>}
      </div>

      {!hasBLE && (
        <div className="mb-2 rounded px-2 py-2 text-yellow-400/80" style={{ background: '#3a3520', border: '1px solid #554820', fontSize: 10 }}>
          Web Bluetooth not available. Needs Chrome or Edge on desktop.
        </div>
      )}

      {status === 'disconnected' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <SectionLabel>Wireless / BLE</SectionLabel>
            <DeviceButton
              onClick={connectHuion}
              disabled={!hasBLE}
              iconBg="#1a3a2a"
              iconBorder="#2a5a3a"
              iconStroke="#4ade80"
              iconPath={<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12h8M12 8v8" /></>}
              name="Huion Note X10"
              desc="BLE smart notepad"
              meta="Connect"
            />
            <DeviceButton
              onClick={() => setShowWacomSetup(true)}
              disabled={!hasBLE}
              iconBg="#183127"
              iconBorder="#285543"
              iconStroke="#6ee7b7"
              iconPath={<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h8" /></>}
              name="Wacom Slate / Folio / Spark"
              desc="Wacom SmartPad / tUHI over BLE"
              meta={sanitizedWacomUuid.length === 12 ? 'Saved UUID' : 'Setup'}
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>Wired / USB HID</SectionLabel>
            <DeviceButton
              onClick={connectHuionUsb}
              disabled={!hasHID}
              iconBg="#2b2438"
              iconBorder="#4b3d62"
              iconStroke="#c4b5fd"
              iconPath={<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M9 11l3-3 3 3" /></>}
              name="Huion Tablet (Experimental)"
              desc="USB tablet mode only. Experimental."
              meta="Experimental"
            />
          </div>
          <div className="space-y-2">
            <SectionLabel>Notebook Downloads</SectionLabel>
            <PSButton onClick={() => onOpenMemoryPage?.()} disabled={!onOpenMemoryPage} active={false}>
              <span className="text-neutral-300">Open Notebook Downloads</span>
            </PSButton>
            <div className="px-1 text-neutral-500" style={{ fontSize: 9 }}>
              Open previously downloaded Huion and Wacom/tUHI notebook pages without reconnecting a device first.
            </div>
          </div>
        </div>
      )}

      {status === 'connecting' && (
        <div className="flex flex-col items-center gap-2 py-7 text-neutral-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-blue-400" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{statusText || 'Connecting...'}</span>
          {pairingInstruction && (
            <div className="mx-4 mt-2 rounded-xl border px-3 py-2 text-left" style={{
              background: pairingInstruction.tone === 'green' ? '#173024' : pairingInstruction.tone === 'blue' ? '#17283e' : '#3a3520',
              borderColor: pairingInstruction.tone === 'green' ? '#2d6a4f' : pairingInstruction.tone === 'blue' ? '#335b8d' : '#6b5a22',
              color: pairingInstruction.tone === 'green' ? '#b7f7d0' : pairingInstruction.tone === 'blue' ? '#bfdbfe' : '#f6dea1',
              fontSize: 10.5,
              lineHeight: 1.45,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>{pairingInstruction.title}</div>
              <div>{pairingInstruction.body}</div>
            </div>
          )}
          <button onClick={disconnect} className="mt-1 text-neutral-500 hover:text-neutral-300" style={{ fontSize: 10.5 }}>Cancel</button>
        </div>
      )}

      {(status === 'connected' || status === 'streaming' || status === 'downloading') && (
        <div className="space-y-3">
          <div>
            <SectionLabel>Device</SectionLabel>
            <div className="space-y-1 px-1">
              <InfoRow label="Name" value={deviceName} />
              <InfoRow label="Type" value={deviceTypeLabel} />
              {capabilityLabel && <InfoRow label="Modes" value={capabilityLabel} />}
              <InfoRow label="Active" value={activeModeLabel} />
              {liveModeLabel && <InfoRow label="Mapping" value={liveModeLabel} />}
              {activeDeviceType === 'wacom' && wacomRef.current && (
                <InfoRow
                  label="Canvas"
                  value={`${getWacomCanvasSize(wacomRef.current, wacomOrientation).width} x ${getWacomCanvasSize(wacomRef.current, wacomOrientation).height}`}
                />
              )}
              {activeDeviceType === 'huion' && huionRef.current && (
                <InfoRow label="Canvas" value={`${huionRef.current.config.pageWidth} x ${huionRef.current.config.pageHeight}`} />
              )}
              {activeDeviceType === 'wacom' && sanitizedWacomUuid && <InfoRow label="UUID" value={sanitizedWacomUuid} />}
            </div>
            <div className="mt-3">
              <PSButton onClick={requestCanvasMatch} active={false}>
                <span className="text-neutral-300">Match Canvas Size</span>
              </PSButton>
            </div>
          </div>

          <div>
            <SectionLabel>Plastic Nib / Tablet Mode</SectionLabel>
            <PSButton onClick={toggleStreaming} disabled={status === 'downloading'} active={isStreaming}>
              {isStreaming ? (
                <><div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" /><span className="text-blue-300">Streaming - Stop</span></>
              ) : (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="#888" stroke="none"><polygon points="5,3 19,12 5,21" /></svg><span className="text-neutral-300">Start Drawing Tablet</span></>
              )}
            </PSButton>
            {isStreaming && <div className="mt-1 px-1 text-blue-400/60" style={{ fontSize: 9 }}>{streamingLabel}</div>}
          </div>

          {activeDeviceType === 'huion' && activeTransport === 'ble' && (
            <div>
              <SectionLabel>Huion BLE Mode</SectionLabel>
              <ModeToggle
                value={huionInputMode}
                onChange={(value) => setHuionInputMode(value as LiveInputPreset)}
              />
              <div className="mt-1 px-1 text-neutral-500" style={{ fontSize: 9 }}>
                Normal keeps the raw Huion orientation. Tablet mode rotates live BLE input for screen drawing.
              </div>
            </div>
          )}

          {activeDeviceType === 'huion' && activeTransport === 'usb' && (
            <div>
              <SectionLabel>Input Mapping</SectionLabel>
              <ModeToggle
                value={huionInputMode}
                onChange={(value) => setHuionInputMode(value as LiveInputPreset)}
                firstLabel="Normal"
              />
            </div>
          )}

          {activeDeviceType === 'wacom' && (
            <div>
              <SectionLabel>Wacom/tUHI BLE Mode</SectionLabel>
              <OrientationToggle
                value={wacomOrientation}
                onChange={setWacomOrientation}
              />
              <div className="mt-1 px-1 text-neutral-500" style={{ fontSize: 9 }}>
                Wacom live input is orientation-sensitive. Use the orientation that matches how the notebook is rotated in front of you.
              </div>
            </div>
          )}

          {activeDeviceType === 'wacom' && (
              <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 px-3 py-2.5 text-[10.5px] text-amber-100/80">
                Wacom/tUHI registration is saved in this browser. If the notebook is factory-reset, clear the UUID and register again.
              </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between px-1">
              <SectionLabel className="mb-0">Pressure Curve</SectionLabel>
              <span className="text-neutral-400" style={{ fontSize: 10 }}>{pressureSensitivity}%</span>
            </div>
            <Slider value={[pressureSensitivity]} onValueChange={([value]) => setPressureSensitivity(value)} min={10} max={200} step={5} />
          </div>

          <div className="border-t border-neutral-700/60" />

          {deviceCapabilities?.paper && (
            <div>
              <SectionLabel>{activeDeviceType === 'wacom' ? 'Wacom/tUHI Notebook Downloads' : 'Huion Notebook Downloads'}</SectionLabel>
              <PSButton onClick={activeDeviceType === 'wacom' ? downloadWacomPages : downloadHuionPages} disabled={status === 'downloading' || isStreaming} active={false}>
                {status === 'downloading' ? (
                  <><div className="h-3 w-3 animate-spin rounded-full border border-neutral-500 border-t-yellow-400" /><span className="text-yellow-300">Downloading...</span></>
                ) : (
                  <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" /></svg><span className="text-neutral-300">{activeDeviceType === 'wacom' ? 'Download Pages from Wacom/tUHI Notebook' : 'Download Pages from Huion Notebook'}</span></>
                )}
              </PSButton>
              <PSButton onClick={() => onOpenMemoryPage?.()} disabled={status === 'downloading'} active={false}>
                <span className="text-neutral-300">Open Notebook Downloads</span>
              </PSButton>
              {pageCount > 0 && <div className="mt-1 px-1 text-green-400/60" style={{ fontSize: 9 }}>{pageCount} page{pageCount > 1 ? 's' : ''} downloaded from {activeDeviceType === 'wacom' ? 'the Wacom/tUHI notebook' : 'the Huion notebook'} and saved in the library</div>}
            </div>
          )}

          <div className="border-t border-neutral-700/60" />

          <div>
            <button onClick={() => setShowLog(!showLog)} className="flex w-full items-center justify-between px-1 py-1 text-neutral-500 hover:text-neutral-300" style={{ fontSize: 10.5 }}>
              <span style={{ letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: 10, fontWeight: 500 }}>Protocol Log</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: showLog ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}><polyline points="6,9 12,15 18,9" /></svg>
            </button>
            {showLog && (
              <ScrollArea className="mt-1 h-24 rounded" style={{ background: '#141414', border: '1px solid #333' }}>
                <div className="space-y-px p-2 font-mono" style={{ fontSize: 9.5 }}>
                  {log.length === 0 && <div className="italic text-neutral-600">No messages yet</div>}
                  {log.map((line, index) => <div key={index} className={/error|failed/i.test(line) ? 'text-red-400/70' : 'text-neutral-500'}>{line}</div>)}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          <button onClick={disconnect} className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-neutral-500 transition-colors hover:text-red-400" style={{ background: 'linear-gradient(180deg, #2e2e2e 0%, #262626 100%)', border: '1px solid #444', fontSize: 10.5 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
            Disconnect
          </button>
        </div>
      )}

      {status === 'disconnected' && showWacomSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowWacomSetup(false)}>
          <div
            className="w-full max-w-sm rounded-3xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-neutral-100">Wacom/tUHI Setup</div>
                <div className="mt-1 text-[11.5px] text-neutral-400">
                  Enter the saved UUID or register a new one for Wacom Slate, Folio, Spark, or another tUHI-compatible SmartPad.
                </div>
              </div>
              <button
                onClick={() => setShowWacomSetup(false)}
                className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                aria-label="Close Wacom/tUHI setup"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-3">
              {pairingInstruction && (
                <div className="rounded-xl border px-3 py-2.5 text-[10.5px] leading-4" style={{
                  background: pairingInstruction.tone === 'green' ? '#173024' : pairingInstruction.tone === 'blue' ? '#17283e' : '#3a3520',
                  borderColor: pairingInstruction.tone === 'green' ? '#2d6a4f' : pairingInstruction.tone === 'blue' ? '#335b8d' : '#6b5a22',
                  color: pairingInstruction.tone === 'green' ? '#b7f7d0' : pairingInstruction.tone === 'blue' ? '#bfdbfe' : '#f6dea1',
                }}>
                  <div className="mb-1 font-semibold">{pairingInstruction.title}</div>
                  <div>{pairingInstruction.body}</div>
                </div>
              )}

              <div className="space-y-1">
                <SectionLabel className="mb-1">Registered UUID</SectionLabel>
                <Input
                  value={wacomUuid}
                  onChange={(event) => setWacomUuid(sanitizeHex12(event.target.value))}
                  placeholder="12 hex characters"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-9 border-neutral-700 bg-neutral-950 font-mono text-xs text-neutral-100 placeholder:text-neutral-500"
                />
                <div className="px-1 text-[10.5px] leading-4 text-neutral-500">
                  Register UUID is only for first-time setup or after a factory reset. Once saved, use Connect for normal pairing and notebook downloads.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PSButton onClick={connectWacom} disabled={!hasBLE || sanitizedWacomUuid.length !== 12} active={false}>
                  <span className="text-neutral-300">Connect</span>
                </PSButton>
                <PSButton onClick={registerWacom} disabled={!hasBLE} active={false}>
                  <span className="text-amber-200">Register UUID</span>
                </PSButton>
              </div>

              <Button
                variant="ghost"
                className="h-8 w-full justify-center text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                onClick={() => {
                  setWacomUuid('');
                  persistWacomUuid('');
                }}
              >
                Clear saved UUID
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-1.5 px-1 text-neutral-500 ${className}`} style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ fontSize: 10.5 }}>
      <span className="text-neutral-500">{label}</span>
      <span className="ml-2 max-w-[140px] truncate font-mono text-neutral-300">{value}</span>
    </div>
  );
}

function formatWacomOrientationLabel(orientation: WacomLiveOrientation) {
  switch (orientation) {
    case 'portrait':
      return 'Landscape';
    case 'reverse-portrait':
      return 'Rotated Landscape';
    case 'reverse-landscape':
      return 'Rotated Portrait';
    default:
      return 'Portrait';
  }
}

function ModeToggle({
  value,
  onChange,
  firstValue = 'normal',
  secondValue = 'tablet',
  firstLabel = 'Normal Mode',
  secondLabel = 'Tablet Mode',
}: {
  value: string;
  onChange: (value: string) => void;
  firstValue?: string;
  secondValue?: string;
  firstLabel?: string;
  secondLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <PSButton onClick={() => onChange(firstValue)} active={value === firstValue}>
        <span className={value === firstValue ? 'text-blue-300' : 'text-neutral-300'}>{firstLabel}</span>
      </PSButton>
      <PSButton onClick={() => onChange(secondValue)} active={value === secondValue}>
        <span className={value === secondValue ? 'text-blue-300' : 'text-neutral-300'}>{secondLabel}</span>
      </PSButton>
    </div>
  );
}

function OrientationToggle({
  value,
  onChange,
}: {
  value: WacomLiveOrientation;
  onChange: (value: WacomLiveOrientation) => void;
}) {
  const options: Array<{ value: WacomLiveOrientation; label: string }> = [
    { value: 'portrait', label: 'Landscape' },
    { value: 'landscape', label: 'Portrait' },
    { value: 'reverse-portrait', label: 'Rotated Landscape' },
    { value: 'reverse-landscape', label: 'Rotated Portrait' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <PSButton key={option.value} onClick={() => onChange(option.value)} active={value === option.value}>
          <span className={value === option.value ? 'text-blue-300' : 'text-neutral-300'}>{option.label}</span>
        </PSButton>
      ))}
    </div>
  );
}

function PSButton({ onClick, disabled, active, children }: { onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 transition-all disabled:opacity-40"
      style={{
        background: active ? 'linear-gradient(180deg, #1a3a5a 0%, #142a44 100%)' : 'linear-gradient(180deg, #3c3c3c 0%, #303030 100%)',
        border: `1px solid ${active ? '#3b82f6' : '#555'}`,
        boxShadow: active ? '0 0 8px rgba(59,130,246,0.25)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function DeviceButton({ onClick, disabled, iconBg, iconBorder, iconStroke, iconPath, name, desc, meta }: {
  onClick: () => void;
  disabled?: boolean;
  iconBg: string;
  iconBorder: string;
  iconStroke: string;
  iconPath: React.ReactNode;
  name: string;
  desc: string;
  meta?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all disabled:opacity-40"
      style={{ background: 'linear-gradient(180deg, #363636 0%, #2c2c2c 100%)', border: '1px solid #4a4a4a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: iconBg, border: `1px solid ${iconBorder}` }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconStroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{iconPath}</svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-neutral-200" style={{ fontSize: 11.5, fontWeight: 600 }}>{name}</div>
        <div className="truncate text-neutral-500" style={{ fontSize: 9.5 }}>{desc}</div>
      </div>
      {meta && (
        <div
          className="shrink-0 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-neutral-300"
          style={{ borderColor: '#555', background: 'rgba(255,255,255,0.03)' }}
        >
          {meta}
        </div>
      )}
    </button>
  );
}

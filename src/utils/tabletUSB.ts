import type { TabletBackendCapabilities } from '@/types/memory';
import { clamp01, decodePenPacket, hex, listInputReportIds } from '@/utils/packetHeuristics';

export interface USBCommonConfig {
  vendorId: number;
  productId: number;
  productName: string;
}

export interface HuionUSBPenPoint {
  x: number;
  y: number;
  pressure: number;
  status: number;
  timestamp: number;
}

export interface HuionUSBConfig {
  maxX: number;
  maxY: number;
  maxPressure: number;
  pageWidth: number;
  pageHeight: number;
  isA4: boolean;
  battery: number;
  modelName: string;
}

type LogCallback = (msg: string) => void;
type StatusCallback = (status: string) => void;

const HUION_VENDOR_ID = 0x256c;
abstract class BaseTabletUSB implements TabletBackendCapabilities {
  protected device: HIDDevice | null = null;
  protected streaming = false;
  protected rawDebug = false;
  protected inputListener: ((event: HIDInputReportEvent) => void) | null = null;
  protected preferredLayoutLabel: string | null = null;

  onLog: LogCallback | null = null;
  onStatus: StatusCallback | null = null;

  protected log(msg: string) { this.onLog?.(msg); }
  protected setStatus(msg: string) { this.onStatus?.(msg); }

  get isConnected(): boolean {
    return !!this.device?.opened;
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  get capabilities() {
    return { paper: false, tablet: true } as const;
  }

  get deviceName(): string {
    return this.device?.productName ?? 'USB Tablet';
  }

  get deviceInfo(): USBCommonConfig | null {
    if (!this.device) return null;
    return {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      productName: this.device.productName,
    };
  }

  setRawDebug(enabled: boolean) {
    this.rawDebug = enabled;
  }

  protected abstract getFilters(): HIDDeviceFilter[];
  protected abstract handleDecodedPoint(point: { x: number; y: number; pressure: number; isDown: boolean }, reportId: number): void;
  protected abstract getDecodeOptions(): { maxX?: number; maxY?: number; maxPressure?: number };

  async connect(): Promise<void> {
    if (!navigator.hid) throw new Error('WebHID is not available in this browser.');
    this.setStatus('Pick USB tablet...');
    const devices = await navigator.hid.requestDevice({ filters: this.getFilters() });
    const device = devices[0];
    if (!device) throw new Error('No USB HID device selected.');
    await device.open();
    this.device = device;
    this.preferredLayoutLabel = null;
    this.inputListener = (event) => {
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (this.rawDebug) {
        this.log(`USB IN report 0x${event.reportId.toString(16)} (${bytes.length}): ${hex(bytes)}`);
      }
      if (!this.streaming) {
        return;
      }
      const decoded = decodePenPacket(bytes, {
        reportId: event.reportId,
        preferredLayoutLabel: this.preferredLayoutLabel,
        ...this.getDecodeOptions(),
      });
      if (decoded) {
        if (this.preferredLayoutLabel !== decoded.layout.label) {
          this.preferredLayoutLabel = decoded.layout.label;
          this.log(`USB decoder locked to ${decoded.layout.label} on report 0x${event.reportId.toString(16)}`);
        }
        this.handleDecodedPoint(decoded, event.reportId);
      } else if (this.rawDebug) {
        this.log(`USB IN report 0x${event.reportId.toString(16)} did not match any pen layout`);
      }
    };
    device.addEventListener('inputreport', this.inputListener);
    this.log(`Opened USB HID: ${device.productName} (${device.vendorId.toString(16)}:${device.productId.toString(16)})`);
    const inputReports = listInputReportIds(device);
    if (inputReports.length > 0) {
      this.log(`USB HID input reports: ${inputReports.map((reportId) => `0x${reportId.toString(16)}`).join(', ')}`);
    }
    this.setStatus('USB connected');
  }

  async disconnect(): Promise<void> {
    if (this.device && this.inputListener) {
      this.device.removeEventListener('inputreport', this.inputListener);
    }
    if (this.device?.opened) {
      await this.device.close();
    }
    this.device = null;
    this.inputListener = null;
    this.preferredLayoutLabel = null;
    this.streaming = false;
    this.setStatus('Disconnected');
  }

  async startStreaming(): Promise<void> {
    if (!this.device?.opened) throw new Error('USB tablet is not connected.');
    this.streaming = true;
    this.setStatus('USB live');
    this.log('USB input streaming enabled');
  }

  async stopStreaming(): Promise<void> {
    this.streaming = false;
    this.setStatus('USB connected');
    this.log('USB input streaming stopped');
  }
}

export class HuionTabletUSB extends BaseTabletUSB {
  config: HuionUSBConfig = {
    maxX: 32767,
    maxY: 32767,
    maxPressure: 8191,
    pageWidth: 1404,
    pageHeight: 1872,
    isA4: false,
    battery: -1,
    modelName: '',
  };

  onPen: ((point: HuionUSBPenPoint) => void) | null = null;

  protected getFilters(): HIDDeviceFilter[] {
    return [{ vendorId: HUION_VENDOR_ID }];
  }

  protected getDecodeOptions() {
    return {
      maxX: this.config.maxX,
      maxY: this.config.maxY,
      maxPressure: this.config.maxPressure,
    };
  }

  protected handleDecodedPoint(point: { x: number; y: number; pressure: number; isDown: boolean }, reportId: number): void {
    const maxX = this.config.maxX || 32767;
    const maxY = this.config.maxY || 32767;
    const maxPressure = this.config.maxPressure || 8191;
    const normalized = {
      x: clamp01(point.x / maxX),
      y: clamp01(point.y / maxY),
      pressure: clamp01(point.pressure / maxPressure),
      status: point.isDown ? 1 : 0,
      timestamp: performance.now(),
    };
    if (!this.config.modelName && this.device?.productName) {
      this.config.modelName = this.device.productName;
    }
    if (this.rawDebug) {
      this.log(`Huion USB decoded r${reportId}: x=${point.x} y=${point.y} p=${point.pressure} down=${point.isDown ? 1 : 0}`);
    }
    this.onPen?.(normalized);
  }

  async downloadPages(): Promise<never> {
    throw new Error('Stored page download is only available over BLE for Huion Note devices.');
  }
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

type HIDConnectionEvent = Event & { device: HIDDevice };
type HIDInputReportEvent = Event & {
  device: HIDDevice;
  reportId: number;
  data: DataView;
};

interface HIDCollectionInfo {
  usagePage?: number;
  usage?: number;
  type?: string;
  children?: HIDCollectionInfo[];
  inputReports?: Array<{ reportId?: number; items?: unknown[] }>;
  outputReports?: Array<{ reportId?: number; items?: unknown[] }>;
  featureReports?: Array<{ reportId?: number; items?: unknown[] }>;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  addEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: HIDConnectionEvent) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: HIDConnectionEvent) => void): void;
}

interface Navigator {
  readonly hid?: HID;
}

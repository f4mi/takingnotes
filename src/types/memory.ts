export type TabletDeviceType = 'huion' | 'wacom';
export type TabletInputMode = 'paper' | 'tablet';

export interface TabletDeviceCapabilities {
  paper: boolean;
  tablet: boolean;
}

export interface TabletBackendCapabilities {
  readonly capabilities: TabletDeviceCapabilities;
}

export interface DownloadedMemoryPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface DownloadedMemoryStroke {
  points: DownloadedMemoryPoint[];
}

export interface DownloadedMemoryPage {
  id: string;
  pageNum: number;
  strokeCount: number;
  pointCount: number;
  timestamp: number;
  strokes: DownloadedMemoryStroke[];
}

export interface DownloadedMemoryNotebook {
  id: string;
  deviceId: string;
  notebookUuid: string;
  deviceType: TabletDeviceType;
  deviceName: string;
  notebookName: string;
  downloadedAt: number;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
  pages: DownloadedMemoryPage[];
}

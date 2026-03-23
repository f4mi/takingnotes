import type { TabletBackendCapabilities } from '@/types/memory';

/**
 * Huion Note X10 BLE Protocol
 * Reverse-engineered from APK decompilation.
 * 
 * Service: 0000ffe0-0000-1000-8000-00805f9b34fb
 * Write:   0000ffe2-...  (commands)
 * Notify:  0000ffe1-...  (responses)
 * 
 * Frame format: [0xCD] [CMD] [0x08] [P1] [P2] [P3] [P4] [0xED]
 * Auth:         challenge(a,b,c) → ((a+b)<<2)%255, ((b+c)<<2)%255, ((c+10)<<2)%255
 * 
 * Live packets: 11 bytes (or 22 for double):
 *   [header 4 bytes] [Xlo] [Xhi] [Ylo] [Yhi] [Plo] [Phi|status] [checksum]
 * 
 * Offline point records: 6 bytes each within page packages:
 *   [Xlo] [Xhi] [Ylo] [Yhi] [Plo] [Phi|status]
 *   pressure = ((byte5 & 0x1F) << 8) | byte4
 *   status   = byte5 >> 5
 * 
 * Checksum: sum(all_bytes_except_last) & 0xFF
 */

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID  = '0000ffe1-0000-1000-8000-00805f9b34fb';
const WRITE_UUID   = '0000ffe2-0000-1000-8000-00805f9b34fb';

const CMD = {
  VERIFY_CONNECT: 0x81,
  VERIFY_RESPONSE: 0x82,
  CURRENT_PAGE: 0x85,
  REQUEST_PAGE: 0x86,
  PAGE_PACKAGE: 0x87,
  REGET_PACKAGE: 0x88,
  NEXT_PAGE: 0x8A,       // unsolicited notebook button event
  DELETE_PAGE: 0x8B,
  CLEAR_CACHE: 0x8C,
  ONLINE_ENABLE: 0x8D,
  BATTERY: 0x8E,          // reply byte 3 = battery percent
  ROM_INFO: 0x8F,
  DEVICE_NAME: 0x91,      // reply is ASCII string
  MAX_INFO: 0x95,
  SET_PACKET_DISTANCE: 0x96,
} as const;

export interface HuionPenPoint {
  x: number;
  y: number;
  pressure: number;
  status: number; // 0=up, 1-7=down
  timestamp: number;
}

export interface HuionPage {
  pageNum: number;
  strokes: { points: HuionPenPoint[] }[];
}

export interface HuionDeviceConfig {
  maxX: number;
  maxY: number;
  maxPressure: number;
  pageWidth: number;
  pageHeight: number;
  /** True if A4-size device — requires axis swap + Y flip (from APK BluetoothLeService) */
  isA4: boolean;
  /** Battery percentage 0-100, or -1 if unknown */
  battery: number;
  /** Device model name from 0x91 query */
  modelName: string;
}

type PenCallback = (point: HuionPenPoint) => void;
type LogCallback = (msg: string) => void;
type StatusCallback = (status: string) => void;
type PageCallback = (pages: HuionPage[]) => void;

function makeFrame(cmd: number, p1 = 0, p2 = 0, p3 = 0, p4 = 0): Uint8Array {
  return new Uint8Array([0xCD, cmd, 0x08, p1, p2, p3, p4, 0xED]);
}

function verifyChecksum(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  let sum = 0;
  for (let i = 0; i < data.length - 1; i++) sum += data[i];
  return (sum & 0xFF) === data[data.length - 1];
}

function computeAuthResponse(a: number, b: number, c: number): [number, number, number] {
  return [
    (((a + b) << 2) % 255),
    (((b + c) << 2) % 255),
    (((c + 10) << 2) % 255),
  ];
}

/** Max times to re-request a single package before giving up */
const MAX_PACKAGE_RETRIES = 3;
/** Download timeout per page (ms) */
const PAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
/** Huion app waits about 1s for the page stream to go idle before gap recovery */
const PACKAGE_RETRY_IDLE_MS = 1_000;
/** Huion app logical page size (HiConfig.DEFAULT_PAGE_WIDTH/HEIGHT for A5) */
const HUION_DEFAULT_PAGE_WIDTH_A5 = 1409;
const HUION_DEFAULT_PAGE_HEIGHT_A5 = 1869;
const HUION_DEFAULT_PAGE_WIDTH_A4 = 2100;
const HUION_DEFAULT_PAGE_HEIGHT_A4 = 2970;
/** APK-derived offline pressure threshold (percent) */
const FILTER_PRESS_PERCENT = 7;
/** APK PointFilter distance threshold in logical page units */
const OFFLINE_POINT_FILTER_DISTANCE = 2.5;
/** APK pressure smoothing floor between accepted offline points */
const OFFLINE_PRESSURE_FALLOFF_LIMIT = 15;
/** PenPath.dealWithPress() lower clamp when nibProgress=100, pressProgress=50 */
const OFFLINE_MIN_PRESSURE_PERCENT = 5;

interface DecodedOfflinePoint {
  pageX: number;
  pageY: number;
  normalizedX: number;
  normalizedY: number;
  pressurePercent: number;
  status: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class HuionNoteBLE implements TabletBackendCapabilities {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  private challenge: [number, number, number] | null = null;
  private authenticated = false;
  private streaming = false;

  config: HuionDeviceConfig = {
    maxX: 32767, maxY: 32767, maxPressure: 8191,
    pageWidth: HUION_DEFAULT_PAGE_WIDTH_A5, pageHeight: HUION_DEFAULT_PAGE_HEIGHT_A5,
    isA4: false,
    battery: -1,
    modelName: '',
  };

  // Page download state
  private pagePackages: Map<number, Uint8Array[]> = new Map();
  private packageRetries: Map<number, number> = new Map(); // pkgNum → retry count
  private expectedPackageCount = 0;
  private currentDownloadPage = 0;
  private pageResolve: ((pages: HuionPage[]) => void) | null = null;
  private downloadedPages: HuionPage[] = [];
  private totalPages = 0;
  private romUsed = 0;
  private romTotal = 0;
  private downloadTimer: ReturnType<typeof setTimeout> | null = null;
  private pageRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks
  onPen: PenCallback | null = null;
  onLog: LogCallback | null = null;
  onStatus: StatusCallback | null = null;
  onPages: PageCallback | null = null;
  onNextPage: (() => void) | null = null;

  private log(msg: string) { this.onLog?.(msg); }
  private setStatus(s: string) { this.onStatus?.(s); }

  get isConnected() { return this.authenticated; }
  get isStreaming() { return this.streaming; }
  get deviceName() { return this.device?.name ?? 'Unknown'; }
  get notebookUuid() {
    const rawId = this.device?.id || this.device?.name || 'unknown';
    return `huion:${rawId}`;
  }
  get capabilities() {
    return { paper: true, tablet: true } as const;
  }

  // Connection completion promise
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  async connect(): Promise<void> {
    this.setStatus('Scanning...');
    this.log('[1/7] Requesting BLE device (filters: Huion, HUION, Note)...');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Huion' }, { namePrefix: 'HUION' }, { namePrefix: 'Note' }],
        optionalServices: [SERVICE_UUID, 'battery_service'],
      });
    } catch (e: any) {
      throw new Error(`BLE device request failed: ${e?.message ?? e}. Is the device on and in range? Did you pick it in the Chrome popup?`);
    }

    this.log(`[2/7] Device selected: ${this.device.name ?? 'unnamed'} (${this.device.id})`);

    this.device.addEventListener('gattserverdisconnected', () => {
      this.authenticated = false;
      this.streaming = false;
      this.setStatus('Disconnected');
      this.log('Device disconnected');
      if (this.connectReject) {
        this.connectReject(new Error('Device disconnected during handshake'));
        this.connectResolve = null;
        this.connectReject = null;
      }
      if (this.pageResolve) {
        this.log('Download interrupted by disconnect');
        const pages = [...this.downloadedPages];
        this.pageResolve(pages);
        this.pageResolve = null;
        this.clearPageRetryTimer();
        if (this.downloadTimer) {
          clearTimeout(this.downloadTimer);
          this.downloadTimer = null;
        }
      }
    });

    this.setStatus('Connecting GATT...');
    this.log('[3/7] Connecting GATT server...');

    try {
      this.server = await this.device.gatt!.connect();
    } catch (e: any) {
      throw new Error(`GATT connect failed: ${e?.message ?? e}`);
    }

    this.log('[4/7] GATT connected, discovering service FFE0...');

    try {
      const svc = await this.server.getPrimaryService(SERVICE_UUID);
      this.writeChar = await svc.getCharacteristic(WRITE_UUID);
      this.notifyChar = await svc.getCharacteristic(NOTIFY_UUID);
    } catch (e: any) {
      throw new Error(`Service/characteristic discovery failed: ${e?.message ?? e}. Is this a Huion Note device?`);
    }

    this.log('[5/7] FFE0/FFE1/FFE2 found, enabling notifications...');

    // Attach listener BEFORE startNotifications to avoid missing early packets
    this.notifyChar.addEventListener('characteristicvaluechanged', (e: Event) => {
      const val = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      this.handleNotification(new Uint8Array(val.buffer, val.byteOffset, val.byteLength))
        .catch((err) => this.log(`Notification handler error: ${err?.message ?? err}`));
    });

    try {
      await this.notifyChar.startNotifications();
      this.log('FFE1 notifications enabled');
    } catch (e: any) {
      throw new Error(`Failed to start FFE1 notifications: ${e?.message ?? e}`);
    }

    // The Huion APK also enables notifications on FFE2 (the write char).
    // This is unusual but was observed in the decomp — some firmware versions
    // may send responses on FFE2 or need the CCCD written on both.
    try {
      this.writeChar.addEventListener('characteristicvaluechanged', (e: Event) => {
        const val = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const bytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
        this.log(`RX (FFE2): ${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')} [log only, not processed]`);
      });
      await this.writeChar.startNotifications();
      this.log('FFE2 notifications also enabled (log only)');
    } catch {
      this.log('FFE2 notifications not supported (normal)');
    }

    // Wait for BLE stack to settle — the APK waits ~2.1s after service discovery
    await this.sleep(500);

    this.log('[6/7] Notifications ready, starting handshake (CD 81 08 ...)...');
    this.setStatus('Handshaking...');

    // Wait for full handshake + MAX_INFO to complete
    await new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      setTimeout(() => {
        if (this.connectResolve) {
          this.connectResolve = null;
          this.connectReject = null;
          reject(new Error('Handshake timeout (10s). Device found but auth did not complete. Check protocol log for details.'));
        }
      }, 10000);
      this.write(makeFrame(CMD.VERIFY_CONNECT)).catch(reject);
    });

    this.log('[7/7] Handshake complete, connected!');
  }

  async disconnect(): Promise<void> {
    if (this.streaming) await this.stopStreaming();
    this.clearPageRetryTimer();
    this.device?.gatt?.disconnect();
    this.authenticated = false;
    this.streaming = false;
    this.setStatus('Disconnected');
  }

  async startStreaming(): Promise<void> {
    if (!this.authenticated) throw new Error('Not authenticated');
    // Configure streaming parameters (from APK decompilation):
    // CMD 0x96 (1, 3, 0, 0) = set sampling mode / report rate
    // CMD 0x96 (3, 2, 0, 0) = set minimum point distance filter
    await this.write(makeFrame(CMD.SET_PACKET_DISTANCE, 1, 3, 0, 0));
    await this.sleep(100);
    await this.write(makeFrame(CMD.SET_PACKET_DISTANCE, 3, 2, 0, 0));
    await this.sleep(100);
    // Capture-proven two-step enable sequence:
    //   Step 1: send 0x8d mode=3, wait for ack (cd 8d 04 01)
    //   Step 2: send 0x8d mode=1, wait for ack (cd 8d 04 01)
    // The captures show mode 3 is sent first (possibly "prepare" mode),
    // then mode 1 starts the actual pen data stream.
    await this.write(makeFrame(CMD.ONLINE_ENABLE, 3, 0, 0, 0));
    await this.sleep(200);
    await this.write(makeFrame(CMD.ONLINE_ENABLE, 1, 0, 0, 0));
    this.streaming = true;
    this.setStatus('Live streaming');
    this.log('Live streaming started');
  }

  async stopStreaming(): Promise<void> {
    await this.write(makeFrame(CMD.ONLINE_ENABLE, 0, 0, 0, 0));
    this.streaming = false;
    this.setStatus('Connected');
    this.log('Live streaming stopped');
  }

  async downloadPages(): Promise<HuionPage[]> {
    if (!this.authenticated) throw new Error('Not authenticated');
    this.log('Requesting ROM info...');
    this.packageRetries.clear();
    this.pagePackages.clear();
    this.expectedPackageCount = 0;
    this.clearPageRetryTimer();
    await this.write(makeFrame(CMD.ROM_INFO));
    
    return new Promise((resolve) => {
      this.pageResolve = resolve;
      this.downloadedPages = [];
      // Timeout scales with expected work: base 15s + 15s per page
      // Will be reset when we know the actual page count (in ROM_INFO handler)
      this.downloadTimer = setTimeout(() => {
        if (this.pageResolve) {
          this.log('Page download timed out');
          const pages = [...this.downloadedPages];
          this.clearPageRetryTimer();
          this.pageResolve = null;
          this.downloadTimer = null;
          resolve(pages);
        }
      }, PAGE_DOWNLOAD_TIMEOUT_MS);
    });
  }

  // --- Private ---

  private async write(data: Uint8Array) {
    if (!this.writeChar) throw new Error('Not connected');
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    this.log(`TX: ${hex}`);
    const payload = new Uint8Array(data);
    // Try write-without-response first (most BLE devices prefer this),
    // fall back to write-with-response, then deprecated writeValue
    try {
      if (this.writeChar.writeValueWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(payload);
      } else {
        throw new Error('writeValueWithoutResponse unavailable');
      }
    } catch {
      try {
        if (this.writeChar.writeValueWithResponse) {
          await this.writeChar.writeValueWithResponse(payload);
        } else {
          throw new Error('writeValueWithResponse unavailable');
        }
      } catch {
        await this.writeChar.writeValue(payload);
      }
    }
  }

  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  private clearPageRetryTimer() {
    if (this.pageRetryTimer) {
      clearTimeout(this.pageRetryTimer);
      this.pageRetryTimer = null;
    }
  }

  private scheduleOfflinePageVerification() {
    this.clearPageRetryTimer();
    if (!this.pageResolve || this.expectedPackageCount <= 0) {
      return;
    }
    this.pageRetryTimer = setTimeout(() => {
      void this.verifyAndRecoverOfflinePage().catch((err) => {
        this.log(`Offline page verification failed: ${err?.message ?? err}`);
      });
    }, PACKAGE_RETRY_IDLE_MS);
  }

  private async requestPageDownload(pageNum: number) {
    this.currentDownloadPage = pageNum;
    this.expectedPackageCount = 0;
    this.pagePackages.set(pageNum, []);
    this.packageRetries.clear();
    this.clearPageRetryTimer();
    this.setStatus(`Downloading page ${pageNum + 1}/${this.totalPages}`);
    await this.write(makeFrame(CMD.REQUEST_PAGE, pageNum & 0xFF, (pageNum >> 8) & 0xFF, 0, 0));
  }

  private countReceivedPackages(packages: Uint8Array[]) {
    if (this.expectedPackageCount <= 0) {
      return 0;
    }

    let received = 0;
    for (let pkgNum = 1; pkgNum <= this.expectedPackageCount; pkgNum++) {
      if (packages[pkgNum]) {
        received++;
      }
    }
    return received;
  }

  private async verifyAndRecoverOfflinePage() {
    this.pageRetryTimer = null;
    if (!this.pageResolve || this.expectedPackageCount <= 0) {
      return;
    }

    const packages = this.pagePackages.get(this.currentDownloadPage) || [];
    const missing: number[] = [];
    for (let pkgNum = 1; pkgNum <= this.expectedPackageCount; pkgNum++) {
      if (!packages[pkgNum]) {
        missing.push(pkgNum);
      }
    }

    if (missing.length === 0) {
      await this.finishCurrentPageDownload();
      return;
    }

    let requested = 0;
    for (const pkgNum of missing) {
      const retries = this.packageRetries.get(pkgNum) ?? 0;
      if (retries >= MAX_PACKAGE_RETRIES) {
        continue;
      }

      this.packageRetries.set(pkgNum, retries + 1);
      requested++;
      this.log(`Page ${this.currentDownloadPage} pkg ${pkgNum}: missing, re-requesting (${retries + 1}/${MAX_PACKAGE_RETRIES})`);
      await this.write(makeFrame(
        CMD.REGET_PACKAGE,
        this.currentDownloadPage & 0xFF,
        (this.currentDownloadPage >> 8) & 0xFF,
        pkgNum & 0xFF,
        (pkgNum >> 8) & 0xFF,
      ));
      await this.sleep(40);
    }

    if (requested > 0) {
      this.scheduleOfflinePageVerification();
      return;
    }

    this.log(`Page ${this.currentDownloadPage}: ${missing.length} package(s) still missing after ${MAX_PACKAGE_RETRIES} retries, decoding partial page`);
    await this.finishCurrentPageDownload();
  }

  private async finishCurrentPageDownload() {
    this.clearPageRetryTimer();
    const packages = this.pagePackages.get(this.currentDownloadPage) || [];
    const received = this.countReceivedPackages(packages);
    if (received < this.expectedPackageCount) {
      this.log(`Page ${this.currentDownloadPage}: decoding partial data (${received}/${this.expectedPackageCount} packages)`);
    } else {
      this.log(`Page ${this.currentDownloadPage}: all ${received} packages received`);
    }

    const page = this.decodePage(this.currentDownloadPage, packages);
    this.downloadedPages.push(page);

    if (this.currentDownloadPage + 1 < this.totalPages) {
      await this.requestPageDownload(this.currentDownloadPage + 1);
      return;
    }

    this.log(`All ${this.downloadedPages.length} pages downloaded`);
    this.setStatus('Connected');
    if (this.downloadTimer) {
      clearTimeout(this.downloadTimer);
      this.downloadTimer = null;
    }
    this.pageResolve?.(this.downloadedPages);
    this.pageResolve = null;
  }

  private async handleOfflinePackageResponse(pkgNum: number, data: Uint8Array, source: 'stream' | 'reget') {
    if (pkgNum <= 0) {
      this.log(`Page ${this.currentDownloadPage}: ignoring invalid package number ${pkgNum} from ${source}`);
      return;
    }

    if (!verifyChecksum(data)) {
      const retries = (this.packageRetries.get(pkgNum) ?? 0) + 1;
      this.packageRetries.set(pkgNum, retries);
      if (retries <= MAX_PACKAGE_RETRIES) {
        this.log(`Page ${this.currentDownloadPage} pkg ${pkgNum}: checksum FAILED (${source}, attempt ${retries}/${MAX_PACKAGE_RETRIES}), re-requesting`);
        await this.write(makeFrame(
          CMD.REGET_PACKAGE,
          this.currentDownloadPage & 0xFF,
          (this.currentDownloadPage >> 8) & 0xFF,
          pkgNum & 0xFF,
          (pkgNum >> 8) & 0xFF,
        ));
        this.scheduleOfflinePageVerification();
      } else {
        this.log(`Page ${this.currentDownloadPage} pkg ${pkgNum}: checksum FAILED after ${MAX_PACKAGE_RETRIES} retries, leaving gap`);
      }
      return;
    }

    const packages = this.pagePackages.get(this.currentDownloadPage) || [];
    packages[pkgNum] = data;
    this.pagePackages.set(this.currentDownloadPage, packages);

    const received = this.countReceivedPackages(packages);
    if (received >= this.expectedPackageCount) {
      await this.finishCurrentPageDownload();
      return;
    }

    if (source === 'stream' && pkgNum === this.expectedPackageCount) {
      await this.verifyAndRecoverOfflinePage();
      return;
    }

    this.scheduleOfflinePageVerification();
  }

  private async handleNotification(data: Uint8Array) {
    // Log all incoming packets (skip logging flood of live pen data during streaming)
    if (!this.streaming || data.length < 11 || data[1] !== CMD.ONLINE_ENABLE) {
      const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
      this.log(`RX: ${hex} (${data.length}b)`);
    }
    // Framed command response
    if (data.length >= 3 && data[0] === 0xCD) {
      const cmd = data[1];
      await this.handleCommand(cmd, data);
      // Also check if it's an 11-byte live packet disguised as 0x8D
      if (cmd === CMD.ONLINE_ENABLE && data.length >= 11 && data[data.length - 1] !== 0xED) {
        this.handleOnlineData(data);
      }
      return;
    }
    // Raw 11-byte or 22-byte live packet
    if (data.length === 11 || data.length === 22) {
      this.handleOnlineData(data);
    }
  }

  private async handleCommand(cmd: number, data: Uint8Array) {
    switch (cmd) {
      case CMD.VERIFY_CONNECT: {
        if (data.length >= 6) {
          this.challenge = [data[3], data[4], data[5]];
          const [x, y, z] = computeAuthResponse(...this.challenge);
          this.log(`Challenge: ${this.challenge} → Response: ${x},${y},${z}`);
          await this.write(makeFrame(CMD.VERIFY_RESPONSE, x, y, z, 0));
        }
        break;
      }
      case CMD.VERIFY_RESPONSE: {
        this.authenticated = true;
        this.setStatus('Authenticated');
        this.log('Handshake complete!');
        await this.sleep(100);
        await this.write(makeFrame(CMD.MAX_INFO));
        break;
      }
      case CMD.MAX_INFO: {
        if (data.length >= 11) {
          this.config.maxX = (data[5] << 16) | (data[4] << 8) | data[3];
          this.config.maxY = (data[8] << 16) | (data[7] << 8) | data[6];
          this.config.maxPressure = (data[10] << 8) | data[9];
          // Detect A4 format: physical size > ~180mm in both axes (assuming 5080 DPI)
          // A4 = ~210x297mm, A5 = ~148x210mm — threshold at 180mm ≈ 36,000 units
          const physW = this.config.maxX / 5080 * 25.4;
          const physH = this.config.maxY / 5080 * 25.4;
          this.config.isA4 = physW > 180 && physH > 250;
          this.config.pageWidth = this.config.isA4 ? HUION_DEFAULT_PAGE_WIDTH_A4 : HUION_DEFAULT_PAGE_WIDTH_A5;
          this.config.pageHeight = this.config.isA4 ? HUION_DEFAULT_PAGE_HEIGHT_A4 : HUION_DEFAULT_PAGE_HEIGHT_A5;
          this.log(`MAX X=${this.config.maxX} Y=${this.config.maxY} P=${this.config.maxPressure} ${this.config.isA4 ? '(A4 detected)' : '(A5)'}`);
          this.log(`Page size ≈ ${this.config.pageWidth}x${this.config.pageHeight}`);
          this.setStatus('Connected');
          if (this.connectResolve) {
            this.connectResolve();
            this.connectResolve = null;
            this.connectReject = null;
          }
          // Query battery and device name sequentially (GATT can only handle one at a time)
          try {
            await this.sleep(350);
            await this.write(makeFrame(CMD.BATTERY));
            await this.sleep(350);
            await this.write(makeFrame(CMD.DEVICE_NAME));
          } catch { /* non-critical */ }
        }
        break;
      }
      case CMD.BATTERY: {
        // Capture-proven: cd 8e 04 XX — byte 3 is battery percentage
        if (data.length >= 4) {
          this.config.battery = data[3];
          this.log(`Battery: ${this.config.battery}%`);
        }
        break;
      }
      case CMD.DEVICE_NAME: {
        // Capture-proven: cd 91 XX ... — bytes 3+ are ASCII device name
        if (data.length > 3) {
          // Decode from byte 3 onward, strip null bytes
          const nameBytes = data.slice(3);
          this.config.modelName = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim();
          this.log(`Device name: ${this.config.modelName}`);
          // Check for A4/T910 device by name (from APK: "Huion Tablet_T910" = A4)
          if (this.config.modelName.includes('T910')) {
            this.config.isA4 = true;
            this.config.pageWidth = HUION_DEFAULT_PAGE_WIDTH_A4;
            this.config.pageHeight = HUION_DEFAULT_PAGE_HEIGHT_A4;
            this.log('A4 device detected from device name (T910)');
          }
        }
        break;
      }
      case CMD.NEXT_PAGE: {
        // Capture-proven: unsolicited cd 8a 06 XX 00 00 — physical notebook button press = new page
        this.log(`Notebook button: new page (${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')})`);
        this.onNextPage?.();
        break;
      }
      case CMD.ROM_INFO: {
        if (data.length >= 7) {
          // Capture-proven: cd 8f 08 XX XX XX XX XX — state/status bytes
          // Exact field meaning is unknown from captures alone.
          // The actual page count comes from CURRENT_PAGE (0x85).
          this.romUsed = (data[4] << 8) | data[3];
          this.romTotal = (data[6] << 8) | data[5];
          this.log(`ROM state: [${Array.from(data.slice(3, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
          this.log(`ROM usage: ${this.romUsed}/${this.romTotal}`);
          // Now query actual page count
          if (this.pageResolve) {
            await this.write(makeFrame(CMD.CURRENT_PAGE));
          }
        }
        break;
      }
      case CMD.CURRENT_PAGE: {
        // 0x85 reply: page count at bytes 3-4 (little-endian)
        if (data.length >= 5) {
          this.totalPages = (data[4] << 8) | data[3];
          this.log(`Stored pages: ${this.totalPages}`);
          if (this.totalPages > 0 && this.pageResolve) {
            if (this.downloadTimer) clearTimeout(this.downloadTimer);
            const timeoutMs = PAGE_DOWNLOAD_TIMEOUT_MS * Math.max(1, this.totalPages);
            this.downloadTimer = setTimeout(() => {
              if (this.pageResolve) {
                this.log(`Page download timed out after ${timeoutMs}ms`);
                const pages = [...this.downloadedPages];
                this.clearPageRetryTimer();
                this.pageResolve(pages);
                this.pageResolve = null;
                this.downloadTimer = null;
              }
            }, timeoutMs);
            // Captures show page request starts with page 0: cd 86 08 00 00 00 00 ed
            await this.requestPageDownload(0);
          } else if (this.pageResolve) {
            this.log('No pages stored on device');
            this.clearPageRetryTimer();
            if (this.downloadTimer) { clearTimeout(this.downloadTimer); this.downloadTimer = null; }
            this.pageResolve([]);
            this.pageResolve = null;
          }
        }
        break;
      }
      case CMD.REQUEST_PAGE: {
        if (data.length >= 5) {
          this.expectedPackageCount = (data[4] << 8) | data[3];
          this.pagePackages.set(this.currentDownloadPage, []);
          this.packageRetries.clear();
          this.log(`Page ${this.currentDownloadPage}: expecting ${this.expectedPackageCount} packages`);
          if (this.expectedPackageCount === 0) {
            this.log(`Page ${this.currentDownloadPage}: empty page`);
            await this.finishCurrentPageDownload();
          } else {
            this.scheduleOfflinePageVerification();
          }
        }
        break;
      }
      case CMD.PAGE_PACKAGE: {
        if (data.length > 5) {
          const pkgNum = (data[4] << 8) | data[3];
          await this.handleOfflinePackageResponse(pkgNum, data, 'stream');
        }
        break;
      }
      case CMD.REGET_PACKAGE: {
        if (data.length > 5) {
          const pkgNum = (data[4] << 8) | data[3];
          await this.handleOfflinePackageResponse(pkgNum, data, 'reget');
        }
        break;
      }
    }
  }

  private handleOnlineData(data: Uint8Array) {
    const packets: Uint8Array[] = [];
    if (data.length === 11) {
      packets.push(data);
    } else if (data.length === 22) {
      const p1 = new Uint8Array(data.slice(0, 11));
      p1[2] = 11;
      packets.push(p1);
      packets.push(new Uint8Array(data.slice(11)));
    }

    for (const pkt of packets) {
      const point = this.decodeLivePacket(pkt);
      if (point) this.onPen?.(point);
    }
  }

  private decodeLivePacket(pkt: Uint8Array): HuionPenPoint | null {
    if (pkt.length !== 11) return null;
    if (!verifyChecksum(pkt)) return null;
    // 11-byte live layout: [hdr0-3] [Xlo:4] [Xhi:5] [Ylo:6] [Yhi:7] [Plo:8] [Phi|st:9] [chk:10]
    const rawX = (pkt[5] << 8) | pkt[4];
    const rawY = (pkt[7] << 8) | pkt[6];
    const pressureRaw = ((pkt[9] & 0x1F) << 8) | pkt[8];
    const rawStatus = (pkt[9] >> 5) & 0x07;
    const maxP = this.config.maxPressure || 8191;
    const scaledPoint = this.scaleRawPoint(rawX, rawY);
    const pressurePercent = (pressureRaw / maxP) * 100;
    const penActive = rawStatus > 0 && pressurePercent >= FILTER_PRESS_PERCENT;

    return {
      x: scaledPoint.normalizedX,
      y: scaledPoint.normalizedY,
      pressure: penActive ? clamp(pressureRaw / maxP, 0, 1) : 0,
      status: penActive ? rawStatus : 0,
      timestamp: Date.now(),
    };
  }

  private decodePage(pageNum: number, packages: Uint8Array[]): HuionPage {
    const decodedPoints: Array<DecodedOfflinePoint | null> = [];
    const strokes: { points: HuionPenPoint[] }[] = [];
    let currentStroke: HuionPenPoint[] = [];
    const packageCount = Math.max(this.expectedPackageCount, packages.length - 1);

    for (let pkgNum = 1; pkgNum <= packageCount; pkgNum++) {
      const pkg = packages[pkgNum];
      if (!pkg || pkg.length <= 6) {
        decodedPoints.push(null);
        continue;
      }
      // Skip 5-byte header, 1-byte checksum at end
      const pointData = pkg.slice(5, pkg.length - 1);
      // 6-byte point records: [Xlo Xhi Ylo Yhi Plo Phi|status]
      for (let i = 0; i + 5 < pointData.length; i += 6) {
        const xRaw = (pointData[i + 1] << 8) | pointData[i];
        const yRaw = (pointData[i + 3] << 8) | pointData[i + 2];
        const pressureRaw = ((pointData[i + 5] & 0x1F) << 8) | pointData[i + 4];
        const status = (pointData[i + 5] >> 5) & 0x07;
        decodedPoints.push(this.decodeOfflinePoint(xRaw, yRaw, pressureRaw, status));
      }
    }

    let lastAcceptedPressurePercent = 0;
    let previousAcceptedPoint: DecodedOfflinePoint | null = null;

    for (let i = 0; i < decodedPoints.length; i++) {
      const point = decodedPoints[i];
      if (!point) {
        if (currentStroke.length > 0) {
          strokes.push({ points: [...currentStroke] });
          currentStroke = [];
        }
        previousAcceptedPoint = null;
        lastAcceptedPressurePercent = 0;
        continue;
      }
      const isLastPoint = i === decodedPoints.length - 1;
      const isActivePoint = point.pressurePercent !== 0 && point.status !== 0;

      if (isActivePoint && !isLastPoint) {
        if (currentStroke.length === 0) {
          currentStroke = [this.makeStoredPoint(point)];
          previousAcceptedPoint = { ...point };
          lastAcceptedPressurePercent = point.pressurePercent;
        } else {
          const candidate: DecodedOfflinePoint = {
            ...point,
            pressurePercent: this.applyOfflinePressureCurve(point.pressurePercent),
          };

          if (!this.shouldFilterOfflinePoint(previousAcceptedPoint, candidate, currentStroke)) {
            const pressureFloor = lastAcceptedPressurePercent - OFFLINE_PRESSURE_FALLOFF_LIMIT;
            if (candidate.pressurePercent < pressureFloor) {
              candidate.pressurePercent = pressureFloor;
            }

            currentStroke.push(this.makeStoredPoint(candidate));
            previousAcceptedPoint = { ...candidate };
            lastAcceptedPressurePercent = candidate.pressurePercent;
          }
        }
        continue;
      }

      if (currentStroke.length === 0) {
        previousAcceptedPoint = null;
        lastAcceptedPressurePercent = 0;
        continue;
      }

      if (isLastPoint) {
        const finalPoint: DecodedOfflinePoint = {
          ...point,
          pressurePercent: this.applyOfflinePressureCurve(point.pressurePercent),
        };
        if (!this.shouldFilterOfflinePoint(previousAcceptedPoint, finalPoint, currentStroke)) {
          currentStroke.push(this.makeStoredPoint(finalPoint));
        }
      }

      strokes.push({ points: [...currentStroke] });
      currentStroke = [];
      previousAcceptedPoint = null;
      lastAcceptedPressurePercent = 0;
    }

    if (currentStroke.length > 0) {
      strokes.push({ points: [...currentStroke] });
    }

    return { pageNum, strokes };
  }

  private scaleRawPoint(rawX: number, rawY: number) {
    const maxX = this.config.maxX || 32767;
    const maxY = this.config.maxY || 32767;
    const logicalPageWidth = this.config.pageWidth || HUION_DEFAULT_PAGE_WIDTH_A5;
    const logicalPageHeight = this.config.pageHeight || HUION_DEFAULT_PAGE_HEIGHT_A5;

    if (this.config.isA4) {
      const rotatedX = maxY - rawY;
      const rotatedY = rawX;
      const normalizedX = clamp(rotatedX / maxY, 0, 1);
      const normalizedY = clamp(rotatedY / maxX, 0, 1);
      return {
        normalizedX,
        normalizedY,
        pageX: normalizedX * logicalPageWidth,
        pageY: normalizedY * logicalPageHeight,
      };
    }

    const normalizedX = clamp(rawX / maxX, 0, 1);
    const normalizedY = clamp(rawY / maxY, 0, 1);
    return {
      normalizedX,
      normalizedY,
      pageX: normalizedX * logicalPageWidth,
      pageY: normalizedY * logicalPageHeight,
    };
  }

  private decodeOfflinePoint(rawX: number, rawY: number, pressureRaw: number, status: number): DecodedOfflinePoint {
    const scaledPoint = this.scaleRawPoint(rawX, rawY);
    const maxP = this.config.maxPressure || 8191;
    const pressurePercent = (pressureRaw / maxP) * 100;
    const penActive = status > 0 && pressurePercent >= FILTER_PRESS_PERCENT;

    return {
      ...scaledPoint,
      pressurePercent: penActive ? pressurePercent : 0,
      status: penActive ? status : 0,
    };
  }

  private applyOfflinePressureCurve(pressurePercent: number): number {
    return clamp(pressurePercent, OFFLINE_MIN_PRESSURE_PERCENT, 100);
  }

  private makeStoredPoint(point: DecodedOfflinePoint): HuionPenPoint {
    return {
      x: point.normalizedX,
      y: point.normalizedY,
      pressure: point.pressurePercent / 100,
      status: point.status,
      timestamp: Date.now(),
    };
  }

  private shouldFilterOfflinePoint(
    previousAcceptedPoint: DecodedOfflinePoint | null,
    candidate: DecodedOfflinePoint,
    currentStroke: HuionPenPoint[],
  ): boolean {
    if (!previousAcceptedPoint) {
      return false;
    }

    const distance = Math.hypot(
      previousAcceptedPoint.pageX - candidate.pageX,
      previousAcceptedPoint.pageY - candidate.pageY,
    );
    if (distance >= OFFLINE_POINT_FILTER_DISTANCE) {
      return false;
    }

    if (previousAcceptedPoint.pressurePercent >= candidate.pressurePercent) {
      return true;
    }

    previousAcceptedPoint.pressurePercent = candidate.pressurePercent;
    const lastPoint = currentStroke[currentStroke.length - 1];
    if (lastPoint) {
      lastPoint.pressure = candidate.pressurePercent / 100;
    }
    return true;
  }
}

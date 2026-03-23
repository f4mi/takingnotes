import type { TabletBackendCapabilities } from '@/types/memory';

const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_CHRC_TX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_CHRC_RX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const WACOM_LIVE_SERVICE_UUID = '00001523-1212-efde-1523-785feabcd123';
const WACOM_CHRC_LIVE_PEN_DATA_UUID = '00001524-1212-efde-1523-785feabcd123';
const WACOM_OFFLINE_SERVICE_UUID = 'ffee0001-bbaa-9988-7766-554433221100';
const WACOM_OFFLINE_CHRC_PEN_DATA_UUID = 'ffee0003-bbaa-9988-7766-554433221100';
const WACOM_SYSEVENT_SERVICE_UUID = '3a340720-c572-11e5-86c5-0002a5d5c51b';

const DEFAULT_POINT_SIZE = 10;
const DEFAULT_SLATE_PRESSURE_MAX = 2047;
const DEFAULT_SPARK_PRESSURE_MAX = 1023;
const DEFAULT_SLATE_WIDTH = 21600;
const DEFAULT_SLATE_HEIGHT = 14800;
const DEFAULT_SPARK_WIDTH = 21000;
const DEFAULT_SPARK_HEIGHT = 14800;

const DEVICE_ERROR_CODES: Record<number, string> = {
  0x00: 'SUCCESS',
  0x01: 'GENERAL_ERROR',
  0x02: 'INVALID_STATE',
  0x03: 'READ_ONLY_PARAM',
  0x04: 'COMMAND_NOT_SUPPORTED',
  0x07: 'AUTHORIZATION_ERROR',
};

type WacomModel = 'slate' | 'spark';
type WacomOrientation = 'landscape' | 'reverse-landscape' | 'portrait' | 'reverse-portrait';
export type WacomLiveOrientation = WacomOrientation;
type WacomProtocolVariant = 'slate' | 'spark';

type PendingReply = {
  predicate?: (message: WacomNordicMessage) => boolean;
  resolve: (message: WacomNordicMessage) => void;
  reject: (error: Error) => void;
  timer: number;
};

type WacomNordicMessage = {
  opcode: number;
  payload: number[];
};

type StrokePacketType =
  | 'unknown'
  | 'file-header'
  | 'stroke-header'
  | 'stroke-end'
  | 'point'
  | 'delta'
  | 'eof'
  | 'lost-point';

type ParsedStrokePoint = {
  x: number;
  y: number;
  p: number;
};

type ParsedStroke = {
  points: ParsedStrokePoint[];
};

type StrokeDeltaPacket = {
  size: number;
  x: number | null;
  y: number | null;
  p: number | null;
  dx: number | null;
  dy: number | null;
  dp: number | null;
};

type StrokeFileParseResult = {
  strokes: ParsedStroke[];
};

export interface WacomPenPoint {
  x: number;
  y: number;
  pressure: number;
  status: number;
  timestamp: number;
}

export interface WacomPage {
  pageNum: number;
  timestamp: number;
  strokes: { points: WacomPenPoint[] }[];
}

export interface WacomDeviceConfig {
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  pointSize: number;
  pressureMax: number;
  model: WacomModel;
  orientation: WacomOrientation;
  uuid: string;
}

type PenCallback = (point: WacomPenPoint) => void;
type LogCallback = (message: string) => void;
type StatusCallback = (status: string) => void;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function littleU16(bytes: ArrayLike<number>, offset = 0) {
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
}

function littleU32(bytes: ArrayLike<number>, offset = 0) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function bigU16(bytes: ArrayLike<number>, offset = 0) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

function bigU32(bytes: ArrayLike<number>, offset = 0) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function popcount(value: number) {
  let count = 0;
  let current = value >>> 0;
  while (current) {
    count += current & 1;
    current >>>= 1;
  }
  return count;
}

function signedInt8(value: number) {
  return value > 127 ? value - 256 : value;
}

function sanitizeUuid(value: string) {
  return String(value || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
}

function hexUuidToBytes(value: string) {
  const cleaned = sanitizeUuid(value);
  if (!/^[0-9a-f]{12}$/.test(cleaned)) {
    throw new Error('Device UUID must be exactly 12 hex characters.');
  }

  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(Number.parseInt(cleaned.slice(index, index + 2), 16));
  }
  return bytes;
}

function randomUuidHex12() {
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: ArrayLike<number>) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function decodeBcd(byteValue: number) {
  return ((byteValue >> 4) & 0x0f) * 10 + (byteValue & 0x0f);
}

function parseTabletTimestamp(bytes: ArrayLike<number>, offset = 0) {
  if (bytes.length < offset + 6) {
    return Math.floor(Date.now() / 1000);
  }

  const year = 2000 + decodeBcd(bytes[offset]);
  const month = clamp(decodeBcd(bytes[offset + 1]), 1, 12);
  const day = clamp(decodeBcd(bytes[offset + 2]), 1, 31);
  const hour = clamp(decodeBcd(bytes[offset + 3]), 0, 23);
  const minute = clamp(decodeBcd(bytes[offset + 4]), 0, 59);
  const second = clamp(decodeBcd(bytes[offset + 5]), 0, 59);
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000);
}

function crc32(bytes: Uint8Array) {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table.push(crc >>> 0);
  }

  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const tableIndex = (crc ^ bytes[index]) & 0xff;
    crc = (crc >>> 8) ^ table[tableIndex];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function identifyStrokePacket(data: number[]): StrokePacketType {
  const header = data[0];
  const nbytes = popcount(header);
  const payload = data.slice(1, 1 + nbytes);

  if (
    data[0] === 0x67 && data[1] === 0x82 && data[2] === 0x69 && data[3] === 0x65
    || data[0] === 0x62 && data[1] === 0x38 && data[2] === 0x62 && data[3] === 0x74
  ) {
    return 'file-header';
  }

  if (
    data[0] === 0xfc
    && data[1] === 0xff
    && data[2] === 0xff
    && data[3] === 0xff
    && data[4] === 0xff
    && data[5] === 0xff
    && data[6] === 0xff
  ) {
    return 'stroke-end';
  }

  if (payload.length === 8 && payload.every((byte) => byte === 0xff)) {
    return 'eof';
  }

  if ((header & 0x03) === 0) {
    return 'delta';
  }

  if (payload.length === 0) {
    return 'unknown';
  }

  if (payload[0] === 0xfa || (payload[0] === 0xff && payload[1] === 0xee && payload[2] === 0xee)) {
    return 'stroke-header';
  }

  if (payload[0] === 0xff && payload[1] === 0xff) {
    return 'point';
  }

  if (payload[0] === 0xdd && payload[1] === 0xdd) {
    return 'lost-point';
  }

  return 'unknown';
}

function parseStrokeDeltaPacket(data: number[]): StrokeDeltaPacket {
  const header = data[0];
  if ((header & 0x03) !== 0) {
    throw new Error('Invalid stroke delta packet header.');
  }

  const extract = (mask: number, offset: number) => {
    if (mask === 0) {
      return { value: null, delta: null, size: 0 };
    }
    if (mask === 2) {
      const delta = signedInt8(data[offset]);
      if (delta === 0) {
        throw new Error('Invalid zero delta in stroke packet.');
      }
      return { value: null, delta, size: 1 };
    }
    if (mask === 3) {
      return { value: littleU16(data, offset), delta: null, size: 2 };
    }
    throw new Error(`Unsupported stroke packet mask ${mask}.`);
  };

  const xmask = (header & 0b00001100) >> 2;
  const ymask = (header & 0b00110000) >> 4;
  const pmask = (header & 0b11000000) >> 6;

  let offset = 1;
  const xResult = extract(xmask, offset);
  offset += xResult.size;
  const yResult = extract(ymask, offset);
  offset += yResult.size;
  const pResult = extract(pmask, offset);
  offset += pResult.size;

  return {
    size: offset,
    x: xResult.value,
    y: yResult.value,
    p: pResult.value,
    dx: xResult.delta,
    dy: yResult.delta,
    dp: pResult.delta,
  };
}

function parseStrokePointPacket(data: number[]) {
  if (!(data[1] === 0xff && data[2] === 0xff)) {
    throw new Error('Invalid stroke point packet.');
  }
  const maskedHeader = data[0] & ~0x03;
  const packet = parseStrokeDeltaPacket([maskedHeader, ...data.slice(3)]);
  return { ...packet, size: packet.size + 2 };
}

function parseStrokeFile(data: Uint8Array): StrokeFileParseResult {
  const bytes = Array.from(data);
  const headerKey = littleU32(bytes, 0);
  if (headerKey !== littleU32([0x62, 0x38, 0x62, 0x74], 0)) {
    throw new Error('Unsupported Wacom stroke file format.');
  }

  let offset = 4;
  let lastPoint: ParsedStrokePoint = { x: 0, y: 0, p: 0 };
  let lastDelta: ParsedStrokePoint = { x: 0, y: 0, p: 0 };
  const strokes: ParsedStroke[] = [];
  let currentStroke: ParsedStrokePoint[] = [];

  while (offset < bytes.length) {
    const remaining = bytes.slice(offset);
    const packetType = identifyStrokePacket(remaining);

    if (packetType === 'file-header') {
      throw new Error('Unexpected nested stroke file header.');
    }

    if (packetType === 'unknown') {
      const size = 1 + popcount(remaining[0]);
      offset += size;
      continue;
    }

    if (packetType === 'stroke-end') {
      if (currentStroke.length > 0) {
        strokes.push({ points: currentStroke });
        currentStroke = [];
      }
      offset += 1 + popcount(remaining[0]);
      continue;
    }

    if (packetType === 'eof') {
      if (currentStroke.length > 0) {
        strokes.push({ points: currentStroke });
      }
      break;
    }

    if (packetType === 'stroke-header') {
      if (currentStroke.length > 0) {
        strokes.push({ points: currentStroke });
        currentStroke = [];
      }
      lastDelta = { x: 0, y: 0, p: 0 };
      offset += 1 + popcount(remaining[0]);
      continue;
    }

    if (packetType === 'lost-point') {
      offset += 1 + popcount(remaining[0]);
      continue;
    }

    const packet = packetType === 'point'
      ? parseStrokePointPacket(remaining)
      : parseStrokeDeltaPacket(remaining);

    let nextAbsX = lastPoint.x;
    let nextAbsY = lastPoint.y;
    let nextAbsP = lastPoint.p;
    let nextDeltaX = lastDelta.x;
    let nextDeltaY = lastDelta.y;
    let nextDeltaP = lastDelta.p;

    if (packet.dx != null) {
      nextDeltaX += packet.dx;
    } else if (packet.x != null) {
      nextAbsX = packet.x;
      nextDeltaX = 0;
    }

    if (packet.dy != null) {
      nextDeltaY += packet.dy;
    } else if (packet.y != null) {
      nextAbsY = packet.y;
      nextDeltaY = 0;
    }

    if (packet.dp != null) {
      nextDeltaP += packet.dp;
    } else if (packet.p != null) {
      nextAbsP = packet.p;
      nextDeltaP = 0;
    }

    lastDelta = { x: nextDeltaX, y: nextDeltaY, p: nextDeltaP };
    lastPoint = {
      x: nextAbsX + nextDeltaX,
      y: nextAbsY + nextDeltaY,
      p: nextAbsP + nextDeltaP,
    };
    currentStroke.push(lastPoint);
    offset += packet.size;
  }

  return { strokes };
}

export class WacomSmartPadBLE implements TabletBackendCapabilities {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private nordicTx: BluetoothRemoteGATTCharacteristic | null = null;
  private nordicRx: BluetoothRemoteGATTCharacteristic | null = null;
  private livePenChrc: BluetoothRemoteGATTCharacteristic | null = null;
  private offlinePenChrc: BluetoothRemoteGATTCharacteristic | null = null;
  private pendingReplies: PendingReply[] = [];
  private rxBuffer: number[] = [];
  private offlinePenDataBuffer: number[] = [];
  private disconnectListenerBound = false;
  private disconnectExpected = false;
  private hasSyseventNotifications: boolean | null = null;
  private authenticated = false;
  private streaming = false;
  private liveOrientation: WacomLiveOrientation = 'landscape';
  private liveTimeline = 0;
  private currentUuid = '';
  private liveBounds = {
    width: 21600,
    height: 14800,
    xMin: 2500,
    xMax: 20600,
    yMin: 500,
    yMax: 14300,
  };

  config: WacomDeviceConfig = {
    width: DEFAULT_SLATE_WIDTH,
    height: DEFAULT_SLATE_HEIGHT,
    pageWidth: DEFAULT_SLATE_WIDTH / DEFAULT_POINT_SIZE,
    pageHeight: DEFAULT_SLATE_HEIGHT / DEFAULT_POINT_SIZE,
    pointSize: DEFAULT_POINT_SIZE,
    pressureMax: DEFAULT_SLATE_PRESSURE_MAX,
    model: 'slate',
    orientation: 'portrait',
    uuid: '',
  };

  onPen: PenCallback | null = null;
  onLog: LogCallback | null = null;
  onStatus: StatusCallback | null = null;

  private log(message: string) {
    this.onLog?.(message);
  }

  private setStatus(status: string) {
    this.onStatus?.(status);
  }

  get isConnected() {
    return this.authenticated;
  }

  get isStreaming() {
    return this.streaming;
  }

  get capabilities() {
    return { paper: true, tablet: true } as const;
  }

  get deviceName() {
    return (this.device?.name || '').trim() || 'Wacom SmartPad';
  }

  get notebookUuid() {
    const rawId = sanitizeUuid(this.currentUuid) || this.device?.id || this.deviceName;
    return `wacom:${rawId}`;
  }

  get currentLiveOrientation() {
    return this.liveOrientation;
  }

  setLiveOrientation(orientation: WacomLiveOrientation) {
    this.liveOrientation = orientation;
  }

  private protocolVariant(): WacomProtocolVariant {
    if (this.hasSyseventNotifications != null) {
      return this.hasSyseventNotifications ? 'slate' : 'spark';
    }
    return /spark/i.test(this.deviceName) ? 'spark' : 'slate';
  }

  private isSparkModel() {
    return this.protocolVariant() === 'spark';
  }

  private orientNormalizedPoint(u: number, v: number, orientation: WacomOrientation) {
    switch (orientation) {
      case 'reverse-landscape':
        return { x: 1 - u, y: 1 - v };
      case 'portrait':
        return { x: 1 - v, y: u };
      case 'reverse-portrait':
        return { x: v, y: 1 - u };
      default:
        return { x: u, y: v };
    }
  }

  private resetLiveBounds() {
    if (this.isSparkModel()) {
      this.liveBounds.width = DEFAULT_SPARK_WIDTH;
      this.liveBounds.height = DEFAULT_SPARK_HEIGHT;
      this.config.model = 'spark';
      this.config.pressureMax = DEFAULT_SPARK_PRESSURE_MAX;
      this.config.orientation = 'portrait';
      this.liveBounds.xMin = 2100;
      this.liveBounds.yMin = 0;
      this.liveBounds.xMax = this.liveBounds.width;
      this.liveBounds.yMax = this.liveBounds.height;
    } else {
      this.config.model = 'slate';
      this.config.pressureMax = DEFAULT_SLATE_PRESSURE_MAX;
      this.config.orientation = 'portrait';
      this.liveBounds.xMin = 2500;
      this.liveBounds.yMin = 500;
      this.liveBounds.xMax = Math.max(this.liveBounds.width - 1000, this.liveBounds.xMin + 1);
      this.liveBounds.yMax = Math.max(this.liveBounds.height - 500, this.liveBounds.yMin + 1);
    }
  }

  private updatePageBoundsFromCurrentConfig() {
    this.config.pointSize = DEFAULT_POINT_SIZE;
    this.config.width = this.liveBounds.width;
    this.config.height = this.liveBounds.height;
    this.resetLiveBounds();
    const orientedLandscape = this.config.orientation.includes('landscape');
    this.config.pageWidth = Math.round((orientedLandscape ? this.config.width : this.config.height) / DEFAULT_POINT_SIZE);
    this.config.pageHeight = Math.round((orientedLandscape ? this.config.height : this.config.width) / DEFAULT_POINT_SIZE);
  }

  private bindCharacteristicListener(
    current: BluetoothRemoteGATTCharacteristic | null,
    next: BluetoothRemoteGATTCharacteristic,
    type: 'nordic' | 'live' | 'offline',
  ) {
    if (current === next) {
      return;
    }

    if (current) {
      if (type === 'nordic') {
        current.removeEventListener('characteristicvaluechanged', this.onNordicValueChanged);
      } else if (type === 'live') {
        current.removeEventListener('characteristicvaluechanged', this.onLivePenValueChanged);
      } else {
        current.removeEventListener('characteristicvaluechanged', this.onOfflinePenValueChanged);
      }
    }

    if (type === 'nordic') {
      next.addEventListener('characteristicvaluechanged', this.onNordicValueChanged);
    } else if (type === 'live') {
      next.addEventListener('characteristicvaluechanged', this.onLivePenValueChanged);
    } else {
      next.addEventListener('characteristicvaluechanged', this.onOfflinePenValueChanged);
    }
  }

  private clearPendingReplies(error: Error) {
    const pending = this.pendingReplies;
    this.pendingReplies = [];
    for (const waiter of pending) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private enqueueNordicMessage(message: WacomNordicMessage) {
    for (let index = 0; index < this.pendingReplies.length; index += 1) {
      const waiter = this.pendingReplies[index];
      if (!waiter.predicate || waiter.predicate(message)) {
        this.pendingReplies.splice(index, 1);
        window.clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
    }
  }

  private waitForNordicMessage(predicate?: (message: WacomNordicMessage) => boolean, timeoutMs = 6000) {
    return new Promise<WacomNordicMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingReplies = this.pendingReplies.filter((entry) => entry.timer !== timer);
        reject(new Error('Timed out waiting for tablet reply.'));
      }, timeoutMs);

      this.pendingReplies.push({ predicate, resolve, reject, timer });
    });
  }

  private parseAckError(payload: number[]) {
    const code = payload.length > 0 ? payload[0] : 0xff;
    const name = DEVICE_ERROR_CODES[code] || `UNKNOWN_${code}`;
    const error = new Error(`Tablet command failed: ${name} (${code}).`);
    if (code === 0x07 || (code === 0x01 && this.isSparkModel())) {
      error.message = `AUTHORIZATION_ERROR (${code}): UUID rejected by device. Use the registered 12-hex UUID.`;
      return error;
    }
    if (code === 0x02) {
      error.message = `INVALID_STATE (${code}): press the button on ${this.deviceName} once, then retry.`;
      return error;
    }
    return error;
  }

  private async writeNordicCommand(opcode: number, args: number[]) {
    if (!this.nordicTx) {
      throw new Error('Nordic TX characteristic is not available.');
    }

    const payload = Uint8Array.from([opcode, args.length, ...args]);
    this.log(`NUS TX: op=0x${opcode.toString(16)} params=[${bytesToHex(args)}]`);
    if (typeof this.nordicTx.writeValueWithoutResponse === 'function') {
      await this.nordicTx.writeValueWithoutResponse(payload);
      return;
    }
    if (typeof this.nordicTx.writeValueWithResponse === 'function') {
      await this.nordicTx.writeValueWithResponse(payload);
      return;
    }
    await this.nordicTx.writeValue(payload);
  }

  private async sendNordicCommand(
    opcode: number,
    args: number[],
    predicate?: (message: WacomNordicMessage) => boolean,
    timeoutMs = 6000,
  ) {
    await this.writeNordicCommand(opcode, args);
    return this.waitForNordicMessage(predicate, timeoutMs);
  }

  private async ensureDevice() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is unavailable in this browser.');
    }

    if (!this.device) {
      this.setStatus('Scanning...');
      this.log('Requesting Wacom/tUHI device...');
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Bamboo' }, { namePrefix: 'Wacom' }],
        optionalServices: [
          NORDIC_UART_SERVICE_UUID,
          WACOM_LIVE_SERVICE_UUID,
          WACOM_OFFLINE_SERVICE_UUID,
          WACOM_SYSEVENT_SERVICE_UUID,
        ],
      });
      this.log(`Found: ${this.device.name || 'Wacom SmartPad'}`);
    }

    if (!this.disconnectListenerBound) {
      this.device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
      this.disconnectListenerBound = true;
    }
  }

  private async setupTransport(withLive = false) {
    await this.ensureDevice();

    if (!this.device?.gatt) {
      throw new Error('Bluetooth GATT is unavailable on this device.');
    }

    if (!this.server || !this.server.connected) {
      this.server = await this.device.gatt.connect();
      this.log('GATT connected');
    }

    const nordicService = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
    const tx = await nordicService.getCharacteristic(NORDIC_UART_CHRC_TX_UUID);
    const rx = await nordicService.getCharacteristic(NORDIC_UART_CHRC_RX_UUID);
    this.bindCharacteristicListener(this.nordicRx, rx, 'nordic');
    this.nordicTx = tx;
    this.nordicRx = rx;
    await rx.startNotifications();

    if (withLive) {
      const liveService = await this.server.getPrimaryService(WACOM_LIVE_SERVICE_UUID);
      const livePen = await liveService.getCharacteristic(WACOM_CHRC_LIVE_PEN_DATA_UUID);
      this.bindCharacteristicListener(this.livePenChrc, livePen, 'live');
      this.livePenChrc = livePen;
      await livePen.startNotifications();
    }

    const offlineService = await this.server.getPrimaryService(WACOM_OFFLINE_SERVICE_UUID);
    const offlinePen = await offlineService.getCharacteristic(WACOM_OFFLINE_CHRC_PEN_DATA_UUID);
    this.bindCharacteristicListener(this.offlinePenChrc, offlinePen, 'offline');
    this.offlinePenChrc = offlinePen;
    await offlinePen.startNotifications();

    const previousVariant = this.protocolVariant();
    try {
      await this.server.getPrimaryService(WACOM_SYSEVENT_SERVICE_UUID);
      this.hasSyseventNotifications = true;
    } catch {
      this.hasSyseventNotifications = false;
    }
    this.resetLiveBounds();
    if (previousVariant !== this.protocolVariant()) {
      this.log(`Detected ${this.isSparkModel() ? 'Spark' : 'Slate/Folio'} protocol path`);
    }
  }

  private onGattDisconnected = () => {
    this.server = null;
    this.nordicTx = null;
    this.nordicRx = null;
    this.livePenChrc = null;
    this.offlinePenChrc = null;
    this.hasSyseventNotifications = null;
    this.rxBuffer = [];
    this.offlinePenDataBuffer = [];
    this.streaming = false;

    const disconnectError = new Error('Bluetooth disconnected.');
    this.clearPendingReplies(disconnectError);

    if (!this.disconnectExpected) {
      this.authenticated = false;
      this.setStatus('Disconnected');
      this.log('Device disconnected');
    }
    this.disconnectExpected = false;
  };

  private onNordicValueChanged = (event: Event) => {
    const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) {
      return;
    }

    const bytes = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    this.rxBuffer.push(...bytes);

    while (this.rxBuffer.length >= 2) {
      const opcode = this.rxBuffer[0];
      const length = this.rxBuffer[1];
      const needed = 2 + length;
      if (this.rxBuffer.length < needed) {
        break;
      }
      const payload = this.rxBuffer.slice(2, needed);
      this.rxBuffer = this.rxBuffer.slice(needed);
      this.log(`NUS RX: op=0x${opcode.toString(16)} len=${length}`);
      this.enqueueNordicMessage({ opcode, payload });
    }
  };

  private onLivePenValueChanged = (event: Event) => {
    const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) {
      return;
    }

    const packet = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    this.parseLivePacket(packet);
  };

  private onOfflinePenValueChanged = (event: Event) => {
    const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) {
      return;
    }

    const packet = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    this.offlinePenDataBuffer.push(...packet);
  };

  private normalizeLivePoint(rawX: number, rawY: number) {
    const width = Math.max(1, this.liveBounds.xMax - this.liveBounds.xMin);
    const height = Math.max(1, this.liveBounds.yMax - this.liveBounds.yMin);
    const u = clamp((rawX - this.liveBounds.xMin) / width, 0, 1);
    const v = clamp((rawY - this.liveBounds.yMin) / height, 0, 1);
    return this.orientNormalizedPoint(u, v, this.liveOrientation);
  }

  private emitLivePoint(rawX: number, rawY: number, rawPressure: number) {
    const point = this.normalizeLivePoint(rawX, rawY);
    this.onPen?.({
      x: point.x,
      y: point.y,
      pressure: clamp(rawPressure / this.config.pressureMax, 0, 1),
      status: rawPressure > 0 ? 1 : 0,
      timestamp: Date.now(),
    });
  }

  private parseLivePacket(packet: number[]) {
    let offset = 0;
    while (offset + 2 <= packet.length) {
      const kind = packet[offset];
      const length = packet[offset + 1];
      const end = offset + 2 + length;
      if (end > packet.length) {
        break;
      }

      const payload = packet.slice(offset + 2, end);
      if (kind === 0xa2) {
        if (payload.length >= 6) {
          this.liveTimeline = performance.now() + (littleU32(payload, 2) % 1000);
        }
      } else if (kind === 0xa1 && length % 6 === 0) {
        for (let index = 0; index + 5 < payload.length; index += 6) {
          const chunk = payload.slice(index, index + 6);
          if (chunk.every((byte) => byte === 0xff)) {
            continue;
          }
          this.emitLivePoint(littleU16(chunk, 0), littleU16(chunk, 2), littleU16(chunk, 4));
          this.liveTimeline += 5;
        }
      }

      offset = end;
    }
  }

  private async connectWithUuid(uuidBytes: number[]) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const reply = await this.sendNordicCommand(
        0xe6,
        uuidBytes,
        (message) => message.opcode === 0xb3 || message.opcode === 0x50 || message.opcode === 0x51,
        8000,
      );

      if (reply.opcode === 0x50) {
        return;
      }

      if (reply.opcode === 0x51) {
        const reason = reply.payload.length >= 7 ? reply.payload[6] : 0xff;
        if ((reason === 0x00 || reason === 0x03) && attempt < maxAttempts) {
          this.log(`Device not ready yet (${attempt}/${maxAttempts}). Press the button once now...`);
          await new Promise((resolve) => window.setTimeout(resolve, 1400));
          continue;
        }
        if (reason === 0x01 || reason === 0x02) {
          throw new Error('AUTHORIZATION_ERROR: UUID rejected by device.');
        }
        throw new Error(`Tablet rejected UUID during connect (reason 0x${reason.toString(16)}).`);
      }

      if (reply.payload[0] === 0x00) {
        return;
      }

      const error = this.parseAckError(reply.payload);
      if (/INVALID_STATE/.test(error.message) && attempt < maxAttempts) {
        this.log(`Device not ready yet (${attempt}/${maxAttempts}). Press the button once now...`);
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        continue;
      }
      throw error;
    }

    throw new Error(`Unable to connect to ${this.deviceName} after retries.`);
  }

  private async queryDimensions() {
    if (this.isSparkModel()) {
      this.liveBounds.width = DEFAULT_SPARK_WIDTH;
      this.liveBounds.height = DEFAULT_SPARK_HEIGHT;
      this.updatePageBoundsFromCurrentConfig();
      this.log(`Dimensions: ${this.config.width} x ${this.config.height} (Spark fixed size)`);
      return;
    }

    const widthReply = await this.sendNordicCommand(
      0xea,
      [0x03, 0x00],
      (message) => message.opcode === 0xeb || message.opcode === 0xb3,
    );
    if (widthReply.opcode === 0xb3 && widthReply.payload[0] !== 0x00) {
      throw this.parseAckError(widthReply.payload);
    }

    const heightReply = await this.sendNordicCommand(
      0xea,
      [0x04, 0x00],
      (message) => message.opcode === 0xeb || message.opcode === 0xb3,
    );
    if (heightReply.opcode === 0xb3 && heightReply.payload[0] !== 0x00) {
      throw this.parseAckError(heightReply.payload);
    }

    let width = this.liveBounds.width;
    let height = this.liveBounds.height;

    if (widthReply.opcode === 0xeb && widthReply.payload.length >= 6 && littleU16(widthReply.payload, 0) === 0x03) {
      width = littleU32(widthReply.payload, 2);
    }
    if (heightReply.opcode === 0xeb && heightReply.payload.length >= 6 && littleU16(heightReply.payload, 0) === 0x04) {
      height = littleU32(heightReply.payload, 2);
    }

    const scaleIfNeeded = (value: number) => (value < 5000 ? value * DEFAULT_POINT_SIZE : value);
    this.liveBounds.width = scaleIfNeeded(width);
    this.liveBounds.height = scaleIfNeeded(height);
    this.updatePageBoundsFromCurrentConfig();
    this.log(`Dimensions: ${this.config.width} x ${this.config.height}`);
  }

  private async primeSparkOfflineTransfer() {
    if (!this.isSparkModel()) {
      return;
    }

    const reply = await this.sendNordicCommand(0xe3, [], (message) => message.opcode === 0xb3);
    if (reply.payload[0] !== 0x00) {
      throw this.parseAckError(reply.payload);
    }
  }

  private async queryAvailableFileCount() {
    const countReply = await this.sendNordicCommand(
      0xc1,
      [],
      (message) => message.opcode === 0xc2 || message.opcode === 0xb3,
    );
    if (countReply.opcode === 0xb3 && countReply.payload[0] !== 0x00) {
      throw this.parseAckError(countReply.payload);
    }

    if (countReply.opcode !== 0xc2 || countReply.payload.length < 2) {
      return 0;
    }

    return this.isSparkModel() ? bigU16(countReply.payload, 0) : littleU16(countReply.payload, 0);
  }

  private async queryOfflineStrokeMetadata() {
    if (this.isSparkModel()) {
      await this.writeNordicCommand(0xc5, []);
      const firstReply = await this.waitForNordicMessage(
        (message) => message.opcode === 0xc7 || message.opcode === 0xcd || message.opcode === 0xb3,
        6000,
      );
      if (firstReply.opcode === 0xb3 && firstReply.payload[0] !== 0x00) {
        throw this.parseAckError(firstReply.payload);
      }

      let byteCount = 0;
      let timestamp = Math.floor(Date.now() / 1000);
      if (firstReply.opcode === 0xc7 && firstReply.payload.length >= 4) {
        byteCount = bigU32(firstReply.payload, 0);
        try {
          const nextReply = await this.waitForNordicMessage(
            (message) => message.opcode === 0xcd || message.opcode === 0xb3,
            1500,
          );
          if (nextReply.opcode === 0xb3 && nextReply.payload[0] !== 0x00) {
            throw this.parseAckError(nextReply.payload);
          }
          if (nextReply.opcode === 0xcd) {
            timestamp = parseTabletTimestamp(nextReply.payload, 0);
          }
        } catch (error) {
          if (!(error instanceof Error) || !/Timed out waiting for tablet reply/.test(error.message)) {
            throw error;
          }
        }
      } else if (firstReply.opcode === 0xcd) {
        timestamp = parseTabletTimestamp(firstReply.payload, 0);
      }

      return { byteCount, timestamp };
    }

    const metaReply = await this.sendNordicCommand(
      0xcc,
      [],
      (message) => message.opcode === 0xcf || message.opcode === 0xb3,
    );
    if (metaReply.opcode === 0xb3) {
      throw this.parseAckError(metaReply.payload);
    }
    return {
      byteCount: metaReply.payload.length >= 4 ? littleU32(metaReply.payload, 0) : 0,
      timestamp: parseTabletTimestamp(metaReply.payload, 4),
    };
  }

  private async waitForOfflineTransferCompletion() {
    const endReply = await this.waitForNordicMessage(
      (message) => message.opcode === 0xc8 || message.opcode === 0xb3,
      45000,
    );
    if (endReply.opcode === 0xb3) {
      throw this.parseAckError(endReply.payload);
    }
    if (endReply.payload[0] !== 0xed) {
      throw new Error('Unexpected tablet reply while finishing file transfer.');
    }

    if (this.isSparkModel()) {
      const crcReply = await this.waitForNordicMessage(
        (message) => message.opcode === 0xc9 || message.opcode === 0xb3,
        6000,
      );
      if (crcReply.opcode === 0xb3) {
        throw this.parseAckError(crcReply.payload);
      }
      if (crcReply.payload.length < 4) {
        throw new Error('Spark transfer ended without a CRC payload.');
      }
      return bigU32(crcReply.payload, 0);
    }

    if (endReply.payload.length < 5) {
      throw new Error('Slate transfer ended without a CRC payload.');
    }
    return littleU32(endReply.payload, 1);
  }

  private async deleteOldestDownloadedFile() {
    if (this.isSparkModel()) {
      await this.writeNordicCommand(0xca, []);
      return;
    }

    const deleteReply = await this.sendNordicCommand(0xca, [], (message) => message.opcode === 0xb3);
    if (deleteReply.payload[0] !== 0x00) {
      throw this.parseAckError(deleteReply.payload);
    }
  }

  async connect(uuid: string) {
    this.currentUuid = sanitizeUuid(uuid);
    if (!this.currentUuid) {
      throw new Error('Enter the registered 12-hex UUID first.');
    }

    this.config.uuid = this.currentUuid;
    this.setStatus('Connecting...');
    this.log(`Connecting to ${this.deviceName || 'Wacom SmartPad'}...`);

    await this.setupTransport(false);
    await this.connectWithUuid(hexUuidToBytes(this.currentUuid));
    await this.queryDimensions();

    this.authenticated = true;
    this.setStatus('Connected');
    this.log('Connection complete');
  }

  async registerNewUuid() {
    const newUuid = randomUuidHex12();
    const uuidBytes = hexUuidToBytes(newUuid);

    this.setStatus('Registering...');
    this.log(`Preparing registration for ${this.deviceName || 'Wacom SmartPad'}...`);
    await this.setupTransport(false);
    if (this.isSparkModel()) {
      this.log('Using Spark registration flow');
      try {
        await this.connectWithUuid(uuidBytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/AUTHORIZATION_ERROR|GENERAL_ERROR|INVALID_STATE/i.test(message)) {
          throw error;
        }
        this.log(`Spark pre-registration connect returned ${message}; continuing.`);
      }
      await this.writeNordicCommand(0xe3, [0x01]);
    } else {
      this.log('Using Slate/Folio registration flow');
      await this.writeNordicCommand(0xe7, uuidBytes);
    }
    this.log(`Register request sent. UUID: ${newUuid}`);
    this.log('Now press the notebook button to confirm registration...');

    const reply = await this.waitForNordicMessage(
      (message) => message.opcode === 0xe4 || message.opcode === 0x53,
      20000,
    );
    if (!(reply.opcode === 0xe4 || reply.opcode === 0x53)) {
      throw new Error('Unexpected registration reply.');
    }

    this.currentUuid = newUuid;
    this.config.uuid = newUuid;
    this.authenticated = false;
    this.setStatus('Registered');
    this.log(`Registration successful. UUID: ${newUuid}`);
    return newUuid;
  }

  async startStreaming() {
    if (!this.currentUuid) {
      throw new Error('Connect or register the device first.');
    }
    await this.setupTransport(true);
    if (!this.authenticated) {
      await this.connect(this.currentUuid);
      await this.setupTransport(true);
    }

    const reply = await this.sendNordicCommand(0xb1, [0x00], (message) => message.opcode === 0xb3);
    if (reply.payload[0] !== 0x00) {
      throw this.parseAckError(reply.payload);
    }

    this.streaming = true;
    this.setStatus('Live streaming');
    this.log('Live streaming started');
  }

  async stopStreaming() {
    if (this.nordicTx && this.server?.connected) {
      try {
        const reply = await this.sendNordicCommand(0xb1, [0x02], (message) => message.opcode === 0xb3, 4000);
        if (reply.payload[0] !== 0x00) {
          this.log(`Mode reset warning: ${this.parseAckError(reply.payload).message}`);
        }
      } catch {
        // Ignore mode reset failures during teardown.
      }
    }

    this.streaming = false;
    if (this.authenticated) {
      this.setStatus('Connected');
    }
    this.log('Live streaming stopped');
  }

  async downloadPages() {
    if (!this.currentUuid) {
      throw new Error('Connect or register the device first.');
    }

    await this.setupTransport(false);
    if (!this.authenticated) {
      await this.connect(this.currentUuid);
    }

    this.setStatus('Downloading...');
    this.log(`Pulling drawings from ${this.isSparkModel() ? 'Spark' : 'Slate/Folio'} notebook memory...`);

    await this.primeSparkOfflineTransfer();

    const paperModeReply = await this.sendNordicCommand(0xb1, [0x01], (message) => message.opcode === 0xb3);
    if (paperModeReply.payload[0] !== 0x00) {
      throw this.parseAckError(paperModeReply.payload);
    }

    const transferReply = await this.sendNordicCommand(
      0xec,
      [0x06, 0x00, 0x00, 0x00, 0x00, 0x00],
      (message) => message.opcode === 0xb3,
    );
    if (transferReply.payload[0] !== 0x00) {
      throw this.parseAckError(transferReply.payload);
    }

    const fileCount = await this.queryAvailableFileCount();
    const pages: WacomPage[] = [];
    this.log(`Stored pages available: ${fileCount}`);

    for (let index = 0; index < fileCount; index += 1) {
      this.setStatus(`Downloading page ${index + 1}/${fileCount}`);

      const { byteCount, timestamp } = await this.queryOfflineStrokeMetadata();
      if (byteCount > 0) {
        this.log(`Page ${index + 1}: expecting ${byteCount} bytes of offline pen data`);
      }

      this.offlinePenDataBuffer = [];
      const startReply = await this.sendNordicCommand(
        0xc3,
        [],
        (message) => message.opcode === 0xc8 || message.opcode === 0xb3,
      );
      if (startReply.opcode === 0xb3) {
        throw this.parseAckError(startReply.payload);
      }
      if (startReply.payload[0] !== 0xbe) {
        throw new Error('Unexpected tablet reply while starting file transfer.');
      }

      const expectedCrc = await this.waitForOfflineTransferCompletion();
      const penData = Uint8Array.from(this.offlinePenDataBuffer);
      const actualCrc = crc32(penData);
      if (expectedCrc !== actualCrc) {
        throw new Error(`CRC mismatch for page ${index + 1}: expected ${expectedCrc}, got ${actualCrc}.`);
      }

      const parsed = parseStrokeFile(penData);
      const strokes = parsed.strokes.map((stroke) => ({
        points: stroke.points.map((point) => ({
          ...this.orientNormalizedPoint(
            clamp((point.x * this.config.pointSize) / this.config.width, 0, 1),
            clamp((point.y * this.config.pointSize) / this.config.height, 0, 1),
            this.config.orientation,
          ),
          pressure: clamp(point.p / this.config.pressureMax, 0, 1),
          status: point.p > 0 ? 1 : 0,
          timestamp: Date.now(),
        })),
      })).filter((stroke) => stroke.points.length > 0);

      pages.push({
        pageNum: index,
        timestamp: timestamp * 1000,
        strokes,
      });

      await this.deleteOldestDownloadedFile();
    }

    this.setStatus('Connected');
    this.log(`Pulled ${pages.length} drawing(s) from device memory`);
    return pages;
  }

  async disconnect() {
    this.disconnectExpected = true;
    this.authenticated = false;
    this.streaming = false;

    try {
      if (this.server?.connected && this.nordicTx) {
        try {
          await this.sendNordicCommand(0xb1, [0x02], (message) => message.opcode === 0xb3, 2000);
        } catch {
          // Ignore teardown failures.
        }
      }

      if (this.nordicRx) {
        this.nordicRx.removeEventListener('characteristicvaluechanged', this.onNordicValueChanged);
        try {
          await this.nordicRx.stopNotifications();
        } catch {
          // Ignore cleanup failures.
        }
      }
      if (this.livePenChrc) {
        this.livePenChrc.removeEventListener('characteristicvaluechanged', this.onLivePenValueChanged);
        try {
          await this.livePenChrc.stopNotifications();
        } catch {
          // Ignore cleanup failures.
        }
      }
      if (this.offlinePenChrc) {
        this.offlinePenChrc.removeEventListener('characteristicvaluechanged', this.onOfflinePenValueChanged);
        try {
          await this.offlinePenChrc.stopNotifications();
        } catch {
          // Ignore cleanup failures.
        }
      }
    } finally {
      this.clearPendingReplies(new Error('Bluetooth disconnected.'));
      this.rxBuffer = [];
      this.offlinePenDataBuffer = [];
      this.nordicTx = null;
      this.nordicRx = null;
      this.livePenChrc = null;
      this.offlinePenChrc = null;
      this.server = null;
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
      this.setStatus('Disconnected');
    }
  }
}

export {};

declare global {
  interface BluetoothRequestDeviceFilter {
    services?: BluetoothServiceUUID[];
    name?: string;
    namePrefix?: string;
    manufacturerData?: Array<unknown>;
    serviceData?: Array<unknown>;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
    exclusionFilters?: BluetoothRequestDeviceFilter[];
  }

  type BluetoothServiceUUID = number | string;
  type BluetoothCharacteristicUUID = number | string;

  interface Bluetooth {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface Navigator {
    bluetooth: Bluetooth;
  }

  interface BluetoothDevice extends EventTarget {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    value?: DataView;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithResponse?(value: BufferSource): Promise<void>;
    writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  }
}

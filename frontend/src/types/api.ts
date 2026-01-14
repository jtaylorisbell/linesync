export type EventType = 'INTAKE' | 'CONSUME';
export type SignalStatus = 'OPEN' | 'ACKNOWLEDGED' | 'FULFILLED';

export interface ScanRequest {
  station_id: string;
  barcode_raw: string;
}

export interface ScanEventResponse {
  event_id: string;
  event_ts: string;
  event_type: EventType;
  station_id: string;
  item_id: string;
  qty: number;
  on_hand_qty: number;
}

export interface InventoryItem {
  item_id: string;
  on_hand_qty: number;
  intake_total: number;
  consume_total: number;
  last_activity_ts: string | null;
  below_reorder_point: boolean;
}

export interface InventoryListResponse {
  items: InventoryItem[];
  total_items: number;
}

export interface ReplenishmentSignal {
  signal_id: string;
  created_ts: string;
  item_id: string;
  current_qty: number;
  reorder_point: number;
  reorder_qty: number;
  status: SignalStatus;
}

export interface SignalListResponse {
  signals: ReplenishmentSignal[];
  total_open: number;
}

export interface RecentActivityResponse {
  events: ScanEventResponse[];
  limit: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  database: string;
}

export interface CurrentUser {
  email: string | null;
  name: string | null;
  display_name: string;
  is_authenticated: boolean;
}

import type {
  CurrentUser,
  HealthResponse,
  InventoryItem,
  InventoryListResponse,
  RecentActivityResponse,
  ReplenishmentSignal,
  ScanEventResponse,
  ScanRequest,
  SignalListResponse,
} from '../types/api';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(error.detail || 'Request failed', response.status);
  }

  return response.json();
}

export const api = {
  // Health
  health: () => request<HealthResponse>('/health'),

  // User
  getMe: () => request<CurrentUser>('/me'),

  // Events
  createIntakeEvent: (data: ScanRequest) =>
    request<ScanEventResponse>('/events/intake', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createConsumeEvent: (data: ScanRequest) =>
    request<ScanEventResponse>('/events/consume', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getRecentEvents: (limit = 20) =>
    request<RecentActivityResponse>(`/events/recent?limit=${limit}`),

  // Inventory
  listInventory: (limit = 100) =>
    request<InventoryListResponse>(`/inventory?limit=${limit}`),

  getInventoryItem: (itemId: string) =>
    request<InventoryItem>(`/inventory/${encodeURIComponent(itemId)}`),

  // Signals
  listSignals: (params?: { status?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString();
    return request<SignalListResponse>(`/signals${query ? `?${query}` : ''}`);
  },

  acknowledgeSignal: (signalId: string) =>
    request<ReplenishmentSignal>(`/signals/${signalId}/acknowledge`, {
      method: 'POST',
    }),
};

export { ApiError };

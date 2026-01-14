import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine, User, MapPin } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { api, ApiError } from '../api/client';

interface ScanResult {
  success: boolean;
  message: string;
}

// Available consumption stations
const STATIONS = [
  { id: 'LINE_1', name: 'Assembly Line 1' },
  { id: 'LINE_2', name: 'Assembly Line 2' },
  { id: 'LINE_3', name: 'Assembly Line 3' },
  { id: 'PACKAGING', name: 'Packaging Station' },
  { id: 'QC', name: 'Quality Control' },
];

export function SinkPage() {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [stationId, setStationId] = useState(STATIONS[0].id);

  const { data: currentUser } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
  });

  const consumeMutation = useMutation({
    mutationFn: (barcode: string) =>
      api.createConsumeEvent({
        station_id: stationId,
        barcode_raw: barcode,
      }),
    onSuccess: (data) => {
      setLastResult({
        success: true,
        message: `Consumed ${data.qty} units of ${data.item_id}. Remaining: ${data.on_hand_qty}`,
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Scan failed';
      setLastResult({
        success: false,
        message,
      });
    },
  });

  const handleScan = (barcode: string) => {
    consumeMutation.mutate(barcode);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <ArrowUpFromLine className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Consumption Scan</h2>
            <p className="text-gray-500">Scan barcode to consume inventory at the line</p>
          </div>
        </div>
        {currentUser && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <User className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              {currentUser.display_name}
            </span>
          </div>
        )}
      </div>

      {/* Station Selector */}
      <div className="max-w-lg mx-auto mb-6">
        <div className="p-4 bg-white border rounded-lg shadow-sm">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <MapPin className="h-4 w-4" />
            Current Station
          </label>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500"
          >
            {STATIONS.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Select the station where you're consuming inventory
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto">
        <BarcodeScanner
          onScan={handleScan}
          isProcessing={consumeMutation.isPending}
          lastResult={lastResult}
        />
      </div>

      <div className="mt-8 max-w-lg mx-auto">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="font-medium text-amber-700 mb-2">Replenishment Notice</h3>
          <p className="text-sm text-amber-600">
            When inventory drops to 10 units or below, an automatic replenishment
            signal will be created.
          </p>
        </div>
      </div>
    </div>
  );
}

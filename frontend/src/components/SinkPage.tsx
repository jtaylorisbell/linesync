import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine, MapPin, AlertTriangle, Package, Bell, Zap } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { api, ApiError } from '../api/client';
import type { TriggeredSignal } from '../types/api';

interface ScanResult {
  success: boolean;
  message: string;
}

// Available consumption stations
const STATIONS = [
  { id: 'LINE_1', name: 'Assembly Line 1', description: 'Main assembly' },
  { id: 'LINE_2', name: 'Assembly Line 2', description: 'Secondary assembly' },
  { id: 'LINE_3', name: 'Assembly Line 3', description: 'Flex line' },
  { id: 'PACKAGING', name: 'Packaging Station', description: 'Final packaging' },
  { id: 'QC', name: 'Quality Control', description: 'Inspection area' },
];

export function SinkPage() {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [stationId, setStationId] = useState(STATIONS[0].id);
  const [triggeredSignal, setTriggeredSignal] = useState<TriggeredSignal | null>(null);
  const [showSignalAlert, setShowSignalAlert] = useState(false);

  // Auto-dismiss the signal alert after 8 seconds
  useEffect(() => {
    if (showSignalAlert) {
      const timer = setTimeout(() => {
        setShowSignalAlert(false);
        setTriggeredSignal(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [showSignalAlert]);

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

      // Check if a replenishment signal was triggered
      if (data.triggered_signal) {
        setTriggeredSignal(data.triggered_signal);
        setShowSignalAlert(true);
      }

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

  const selectedStation = STATIONS.find(s => s.id === stationId);

  return (
    <div className="p-6 relative">
      {/* Replenishment Signal Alert Overlay */}
      {showSignalAlert && triggeredSignal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative">
            {/* Pulsing rings */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute w-96 h-96 rounded-full border-2 border-[var(--accent-warning)] animate-ping-slow opacity-30" />
              <div className="absolute w-80 h-80 rounded-full border-2 border-[var(--accent-warning)] animate-ping-slower opacity-40" />
            </div>

            {/* Main alert card */}
            <div className="relative bg-gradient-to-br from-[var(--accent-warning)] to-orange-600 rounded-2xl p-8 shadow-2xl animate-bounce-in max-w-md mx-4 glow-amber">
              {/* Bell icon with shake animation */}
              <div className="flex justify-center mb-4">
                <div className="p-4 bg-white/20 rounded-full animate-shake">
                  <Bell className="h-12 w-12 text-white" />
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white text-center mb-2">
                Replenishment Signal
              </h3>
              <p className="text-white/80 text-center text-sm mb-4">
                Stock has dropped below reorder point
              </p>

              <div className="bg-black/20 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <Package className="h-6 w-6 text-white" />
                  <span className="text-xl font-bold text-white font-mono">
                    {triggeredSignal.item_id}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-white/70 text-sm">Current Stock</div>
                    <div className="text-4xl font-bold text-white font-mono">
                      {triggeredSignal.current_qty}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/70 text-sm">Reorder Qty</div>
                    <div className="text-4xl font-bold text-white font-mono">
                      {triggeredSignal.reorder_qty}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-white/80 text-sm mb-4">
                <Zap className="h-4 w-4" />
                <span>Signal sent to warehouse team</span>
              </div>

              <button
                onClick={() => {
                  setShowSignalAlert(false);
                  setTriggeredSignal(null);
                }}
                className="w-full py-3 bg-white/20 hover:bg-white/30 rounded-xl text-white font-semibold transition-colors"
              >
                Continue Scanning
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-[var(--accent-danger)] blur-xl opacity-30" />
          <div className="relative p-3 bg-[var(--accent-danger-dim)] border border-[var(--accent-danger)] rounded-xl">
            <ArrowUpFromLine className="h-7 w-7 text-[var(--accent-danger)]" />
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-[var(--text-primary)]">Consume Inventory</h2>
          <p className="text-[var(--text-muted)]">Scan parts as they're used on the production line</p>
        </div>
      </div>

      {/* Station Selector */}
      <div className="max-w-xl mx-auto mb-8">
        <div className="card-dark p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-5 w-5 text-[var(--accent-primary)]" />
            <label className="font-semibold text-[var(--text-primary)]">
              Select Your Station
            </label>
          </div>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="w-full text-lg"
          >
            {STATIONS.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name} — {station.description}
              </option>
            ))}
          </select>
          {selectedStation && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Currently at: <span className="text-[var(--accent-primary)] font-medium">{selectedStation.name}</span>
            </p>
          )}
        </div>
      </div>

      {/* Scanner */}
      <div className="max-w-xl mx-auto">
        <div className="card-dark p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 bg-[var(--accent-danger-dim)] rounded-lg">
              <ArrowUpFromLine className="h-4 w-4 text-[var(--accent-danger)]" />
            </div>
            <h3 className="font-semibold text-[var(--text-primary)]">Consumption Scanner</h3>
          </div>
          <BarcodeScanner
            onScan={handleScan}
            isProcessing={consumeMutation.isPending}
            lastResult={lastResult}
          />
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-6 max-w-xl mx-auto">
        <div className="p-4 bg-[var(--accent-warning-dim)] border border-[var(--accent-warning)] rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-[var(--accent-warning)] mt-0.5" />
            <div>
              <h4 className="font-medium text-[var(--accent-warning)] mb-1">Auto-Replenishment Active</h4>
              <p className="text-sm text-[var(--text-secondary)]">
                When stock drops to <span className="font-mono font-bold text-[var(--accent-warning)]">10 units</span> or below,
                a replenishment signal is automatically sent to the warehouse team.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

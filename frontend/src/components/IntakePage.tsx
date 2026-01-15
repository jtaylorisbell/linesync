import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Camera, Sparkles, ScanLine, Info } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { PackingSlipUpload } from './PackingSlipUpload';
import { api, ApiError } from '../api/client';

type IntakeMode = 'scan' | 'packing-slip';

interface ScanResult {
  success: boolean;
  message: string;
}

export function IntakePage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<IntakeMode>('scan');
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);

  const intakeMutation = useMutation({
    mutationFn: (barcode: string) =>
      api.createIntakeEvent({
        station_id: 'INTAKE_CAM_1',
        barcode_raw: barcode,
      }),
    onSuccess: (data) => {
      setLastResult({
        success: true,
        message: `Received ${data.qty} units of ${data.item_id}. On-hand: ${data.on_hand_qty}`,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
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
    intakeMutation.mutate(barcode);
  };

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-[var(--accent-success)] blur-xl opacity-30" />
          <div className="relative p-3 bg-[var(--accent-success-dim)] border border-[var(--accent-success)] rounded-xl">
            <ArrowDownToLine className="h-7 w-7 text-[var(--accent-success)]" />
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-[var(--text-primary)]">Receive Inventory</h2>
          <p className="text-[var(--text-muted)]">Scan barcodes or upload packing slips to add stock</p>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="max-w-xl mx-auto mb-8">
        <div className="flex bg-[var(--bg-secondary)] rounded-2xl p-1.5 border border-[var(--border-primary)]">
          <button
            onClick={() => setMode('scan')}
            className={`flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-sm font-medium transition-all duration-300 ${
              mode === 'scan'
                ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] glow-cyan'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <ScanLine className="h-5 w-5" />
            <div className="text-left">
              <span className="block font-semibold">Scan Barcode</span>
              <span className={`text-xs ${mode === 'scan' ? 'text-[var(--bg-primary)]/70' : 'text-[var(--text-muted)]'}`}>
                Use camera to scan
              </span>
            </div>
          </button>
          <button
            onClick={() => setMode('packing-slip')}
            className={`flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-sm font-medium transition-all duration-300 ${
              mode === 'packing-slip'
                ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)] glow-cyan'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Sparkles className="h-5 w-5" />
            <div className="text-left">
              <span className="block font-semibold">AI Packing Slip</span>
              <span className={`text-xs ${mode === 'packing-slip' ? 'text-[var(--bg-primary)]/70' : 'text-[var(--text-muted)]'}`}>
                Upload document
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Content based on mode */}
      {mode === 'scan' ? (
        <>
          <div className="max-w-xl mx-auto">
            <div className="card-dark p-6">
              <div className="flex items-center gap-2 mb-4">
                <Camera className="h-5 w-5 text-[var(--accent-primary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Barcode Scanner</h3>
              </div>
              <BarcodeScanner
                onScan={handleScan}
                isProcessing={intakeMutation.isPending}
                lastResult={lastResult}
              />
            </div>
          </div>

          <div className="mt-6 max-w-xl mx-auto">
            <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-[var(--accent-primary)] mt-0.5" />
                <div>
                  <h4 className="font-medium text-[var(--text-primary)] mb-1">Barcode Format</h4>
                  <code className="text-sm text-[var(--accent-primary)] bg-[var(--bg-elevated)] px-2 py-1 rounded border border-[var(--border-primary)]">
                    ITEM=&lt;part_number&gt;;QTY=&lt;quantity&gt;
                  </code>
                  <p className="text-sm text-[var(--text-muted)] mt-2">
                    Example: <code className="text-[var(--accent-success)] bg-[var(--bg-elevated)] px-1 rounded">ITEM=PART-88219;QTY=24</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="max-w-2xl mx-auto">
          <div className="card-dark p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-[var(--accent-primary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">AI-Powered Document Processing</h3>
            </div>
            <p className="text-[var(--text-muted)] mb-6">
              Upload a photo of your packing slip and our AI will automatically extract all line items.
            </p>
            <PackingSlipUpload />
          </div>
        </div>
      )}
    </div>
  );
}

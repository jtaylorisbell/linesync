import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, User, Camera, FileImage } from 'lucide-react';
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

  const { data: currentUser } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.getMe(),
  });

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
      // Invalidate queries to refresh data
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <ArrowDownToLine className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Intake</h2>
            <p className="text-gray-500">Receive inventory via scan or packing slip</p>
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

      {/* Mode Toggle */}
      <div className="max-w-lg mx-auto mb-6">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setMode('scan')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'scan'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Camera className="h-4 w-4" />
            Scan Barcode
          </button>
          <button
            onClick={() => setMode('packing-slip')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'packing-slip'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileImage className="h-4 w-4" />
            Packing Slip
          </button>
        </div>
      </div>

      {/* Content based on mode */}
      {mode === 'scan' ? (
        <>
          <div className="max-w-lg mx-auto">
            <BarcodeScanner
              onScan={handleScan}
              isProcessing={intakeMutation.isPending}
              lastResult={lastResult}
            />
          </div>

          <div className="mt-8 max-w-lg mx-auto">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium text-gray-700 mb-2">Expected Barcode Format</h3>
              <code className="text-sm bg-white px-2 py-1 rounded border">
                ITEM=&lt;item_id&gt;;QTY=&lt;quantity&gt;
              </code>
              <p className="text-sm text-gray-500 mt-2">
                Example: <code className="bg-white px-1 rounded">ITEM=PART-88219;QTY=24</code>
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="max-w-2xl mx-auto">
          <PackingSlipUpload />
        </div>
      )}
    </div>
  );
}

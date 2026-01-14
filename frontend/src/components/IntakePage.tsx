import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, User } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { api, ApiError } from '../api/client';

interface ScanResult {
  success: boolean;
  message: string;
}

export function IntakePage() {
  const queryClient = useQueryClient();
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
            <h2 className="text-2xl font-bold text-gray-900">Intake Scan</h2>
            <p className="text-gray-500">Scan barcode to receive inventory</p>
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
    </div>
  );
}

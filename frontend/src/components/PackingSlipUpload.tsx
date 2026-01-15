import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CameraOff,
  Loader2,
  Check,
  X,
  AlertCircle,
  Trash2,
  Plus,
  RotateCcw,
  Aperture,
  Sparkles,
  PackageCheck,
  FileText,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ParsedLineItem, BulkIntakeItem } from '../types/api';

interface EditableItem extends ParsedLineItem {
  id: string;
}

interface PackingSlipUploadProps {
  onComplete?: () => void;
}

type InputMode = 'camera' | 'upload';

export function PackingSlipUpload({ onComplete }: PackingSlipUploadProps) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inputMode, setInputMode] = useState<InputMode>('camera');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedItems, setParsedItems] = useState<EditableItem[]>([]);
  const [metadata, setMetadata] = useState<{
    vendor: string | null;
    po_number: string | null;
    ship_date: string | null;
    notes: string | null;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Animation states
  const [showParseSuccess, setShowParseSuccess] = useState(false);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [parsedItemCount, setParsedItemCount] = useState(0);
  const [submittedData, setSubmittedData] = useState<{ items: number; qty: number } | null>(null);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          // Portrait mode: swap width/height for vertical orientation
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 9 / 16 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error('Camera error:', err);
      setCameraError(
        err instanceof Error ? err.message : 'Failed to access camera'
      );
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Initialize camera on mount (only in camera mode)
  useEffect(() => {
    if (inputMode === 'camera' && !capturedImage && !uploadedFile) {
      startCamera();
    }
    return () => {
      if (inputMode !== 'camera') {
        stopCamera();
      }
    };
  }, [inputMode, startCamera, stopCamera, capturedImage, uploadedFile]);

  // Stop camera when switching to upload mode
  useEffect(() => {
    if (inputMode === 'upload') {
      stopCamera();
      setCameraError(null); // Clear any camera errors when switching modes
    }
  }, [inputMode, stopCamera]);

  // Parse mutation - accepts either a data URL string or a File object
  const parseMutation = useMutation({
    mutationFn: async (input: string | File) => {
      let file: File;
      if (typeof input === 'string') {
        // Convert data URL to blob
        const response = await fetch(input);
        const blob = await response.blob();
        file = new File([blob], 'packing-slip.jpg', { type: 'image/jpeg' });
      } else {
        file = input;
      }
      return api.parsePackingSlip(file);
    },
    onSuccess: (data) => {
      const items = data.items.map((item, index) => ({
        ...item,
        id: `item-${index}-${Date.now()}`,
      }));
      setParsedItems(items);
      setMetadata({
        vendor: data.vendor,
        po_number: data.po_number,
        ship_date: data.ship_date,
        notes: data.notes,
      });

      // Trigger parse success animation
      if (items.length > 0) {
        setParsedItemCount(items.length);
        setShowParseSuccess(true);
        setTimeout(() => setShowParseSuccess(false), 2000);
      }
    },
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: (items: BulkIntakeItem[]) =>
      api.createBulkIntake({ station_id: 'PACKING_SLIP', items }),
    onSuccess: (data) => {
      // Trigger submit success animation
      setSubmittedData({ items: data.total_items, qty: data.total_qty });
      setShowSubmitSuccess(true);

      // After animation, reset to camera mode
      setTimeout(() => {
        setShowSubmitSuccess(false);
        setSubmittedData(null);
        setSubmitResult({
          success: true,
          message: `Successfully received ${data.total_items} items (${data.total_qty} total units)`,
        });
        handleRetake();
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['events'] });
        onComplete?.();
      }, 2500);
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to submit intake';
      setSubmitResult({ success: false, message });
    },
  });

  // Capture photo from video
  const handleCapture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setCapturedImage(imageDataUrl);
      stopCamera();

      // Automatically start parsing
      parseMutation.mutate(imageDataUrl);
    }
  }, [stopCamera, parseMutation]);

  // Retake photo / clear upload
  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setUploadedFile(null);
    setParsedItems([]);
    setMetadata(null);
    setSubmitResult(null);
    parseMutation.reset();
    if (inputMode === 'camera') {
      startCamera();
    }
  }, [startCamera, parseMutation, inputMode]);

  // File upload handlers
  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      setSubmitResult({
        success: false,
        message: 'Please upload a PDF or image file (JPEG, PNG, WebP, GIF)',
      });
      return;
    }

    setUploadedFile(file);
    setCapturedImage(null);
    setSubmitResult(null);
    parseMutation.mutate(file);
  }, [parseMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleItemChange = (
    id: string,
    field: 'item_id' | 'qty',
    value: string | number
  ) => {
    setParsedItems((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, [field]: field === 'qty' ? Number(value) : value }
          : item
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    setParsedItems((items) => items.filter((item) => item.id !== id));
  };

  const handleAddItem = () => {
    setParsedItems((items) => [
      ...items,
      {
        id: `item-new-${Date.now()}`,
        item_id: '',
        qty: 1,
        description: null,
        confidence: 'high',
      },
    ]);
  };

  const handleSubmit = () => {
    const validItems = parsedItems.filter(
      (item) => item.item_id.trim() && item.qty > 0
    );
    if (validItems.length === 0) {
      setSubmitResult({ success: false, message: 'No valid items to submit' });
      return;
    }
    submitMutation.mutate(
      validItems.map((item) => ({ item_id: item.item_id, qty: item.qty }))
    );
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return (
          <span className="badge badge-success">
            High
          </span>
        );
      case 'medium':
        return (
          <span className="badge badge-warning">
            Medium
          </span>
        );
      case 'low':
        return (
          <span className="badge badge-danger">
            Low
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex justify-center">
        <div className="flex bg-[var(--bg-secondary)] rounded-xl p-1 border border-[var(--border-primary)]">
          <button
            onClick={() => setInputMode('camera')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              inputMode === 'camera'
                ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Camera className="h-4 w-4" />
            Camera
          </button>
          <button
            onClick={() => setInputMode('upload')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              inputMode === 'upload'
                ? 'bg-[var(--accent-primary)] text-[var(--bg-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Upload className="h-4 w-4" />
            Upload File
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Camera / Upload / Captured View */}
      <div className="relative w-full max-w-2xl mx-auto">
        {!capturedImage && !uploadedFile ? (
          inputMode === 'camera' ? (
            <>
              {/* Live camera feed - portrait orientation */}
              <video
                ref={videoRef}
                className="w-full max-w-md mx-auto rounded-xl bg-black border-2 border-[var(--border-primary)]"
                style={{ minHeight: '500px', maxHeight: '70vh', objectFit: 'cover' }}
                playsInline
                muted
              />

              {/* Camera overlay */}
              {isCameraActive && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* Corner guides */}
                  <div className="absolute top-4 left-4 w-12 h-12 border-l-2 border-t-2 border-[var(--accent-primary)] rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-12 h-12 border-r-2 border-t-2 border-[var(--accent-primary)] rounded-tr-lg" />
                  <div className="absolute bottom-16 left-4 w-12 h-12 border-l-2 border-b-2 border-[var(--accent-primary)] rounded-bl-lg" />
                  <div className="absolute bottom-16 right-4 w-12 h-12 border-r-2 border-b-2 border-[var(--accent-primary)] rounded-br-lg" />

                  {/* Document icon hint */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-30">
                    <FileText className="h-20 w-20 text-[var(--accent-primary)]" />
                  </div>
                </div>
              )}

              {/* Capture button */}
              {isCameraActive && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                  <button
                    onClick={handleCapture}
                    className="p-4 bg-[var(--accent-primary)] rounded-full shadow-lg hover:scale-105 transition-transform glow-cyan"
                    title="Capture"
                  >
                    <Aperture className="h-8 w-8 text-[var(--bg-primary)]" />
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Drop zone for file upload */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center p-12 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                isDragging
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary-dim)] scale-[1.02]'
                  : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              style={{ minHeight: '300px' }}
            >
              <div className={`p-4 rounded-full mb-4 transition-colors ${
                isDragging ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)]'
              }`}>
                <Upload className={`h-10 w-10 ${
                  isDragging ? 'text-[var(--bg-primary)]' : 'text-[var(--accent-primary)]'
                }`} />
              </div>
              <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
                {isDragging ? 'Drop your file here' : 'Drag & drop a file here'}
              </p>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                or click to browse
              </p>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <FileText className="h-4 w-4" />
                <span>PDF, JPEG, PNG, WebP, GIF</span>
              </div>
            </div>
          )
        ) : (
          <>
            {/* Captured image or uploaded file display */}
            {capturedImage ? (
              <img
                src={capturedImage}
                alt="Captured packing slip"
                className="w-full rounded-xl border-2 border-[var(--border-primary)]"
              />
            ) : uploadedFile ? (
              <div className="flex flex-col items-center justify-center p-8 rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)]" style={{ minHeight: '200px' }}>
                <div className="p-4 rounded-full bg-[var(--accent-primary-dim)] mb-4">
                  <FileText className="h-12 w-12 text-[var(--accent-primary)]" />
                </div>
                <p className="text-lg font-medium text-[var(--text-primary)] mb-1">
                  {uploadedFile.name}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {(uploadedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : null}

            {/* Parsing overlay */}
            {parseMutation.isPending && (
              <div className="absolute inset-0 bg-black/70 rounded-xl flex items-center justify-center">
                <div className="bg-[var(--bg-elevated)] px-6 py-4 rounded-xl flex items-center gap-3 border border-[var(--accent-primary)] glow-cyan">
                  <Loader2 className="h-6 w-6 text-[var(--accent-primary)] animate-spin" />
                  <div>
                    <span className="text-[var(--text-primary)] font-medium block">
                      Analyzing with AI...
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      Extracting line items
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Parse success animation */}
            {showParseSuccess && (
              <div className="absolute inset-0 bg-[var(--accent-success)]/80 rounded-xl flex items-center justify-center animate-pulse pointer-events-none">
                <div className="bg-[var(--bg-primary)] px-8 py-6 rounded-xl shadow-2xl flex flex-col items-center gap-3 animate-bounce border border-[var(--accent-success)] glow-green">
                  <div className="relative">
                    <Sparkles className="h-12 w-12 text-[var(--accent-success)]" />
                    <div className="absolute -top-1 -right-1 bg-[var(--accent-success)] text-[var(--bg-primary)] text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                      {parsedItemCount}
                    </div>
                  </div>
                  <span className="text-[var(--accent-success)] font-bold text-lg">
                    {parsedItemCount} Items Found!
                  </span>
                </div>
              </div>
            )}

            {/* Retake button */}
            <button
              onClick={handleRetake}
              className="absolute top-4 right-4 p-2 bg-[var(--bg-elevated)]/90 rounded-xl border border-[var(--border-primary)] hover:border-[var(--accent-primary)] transition-colors"
              title="Retake"
            >
              <RotateCcw className="h-5 w-5 text-[var(--text-primary)]" />
            </button>
          </>
        )}

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Camera status - only show in camera mode */}
      {!capturedImage && !uploadedFile && inputMode === 'camera' && (
        <div className="flex items-center justify-center gap-2">
          {isCameraActive ? (
            <>
              <div className="relative">
                <Camera className="h-5 w-5 text-[var(--accent-success)]" />
                <div className="absolute inset-0 animate-ping">
                  <Camera className="h-5 w-5 text-[var(--accent-success)]" />
                </div>
              </div>
              <span className="text-[var(--accent-success)]">
                Position packing slip in frame and tap capture
              </span>
            </>
          ) : cameraError ? (
            <>
              <CameraOff className="h-5 w-5 text-[var(--accent-danger)]" />
              <span className="text-[var(--accent-danger)]">{cameraError}</span>
            </>
          ) : (
            <>
              <Loader2 className="h-5 w-5 text-[var(--text-muted)] animate-spin" />
              <span className="text-[var(--text-muted)]">Starting camera...</span>
            </>
          )}
        </div>
      )}

      {/* Parse Error */}
      {parseMutation.isError && (
        <div className="p-4 bg-[var(--accent-danger-dim)] border border-[var(--accent-danger)] rounded-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-[var(--accent-danger)] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--accent-danger)]">
              Failed to parse packing slip
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {parseMutation.error instanceof ApiError
                ? parseMutation.error.message
                : 'An error occurred. Try capturing a clearer image.'}
            </p>
          </div>
        </div>
      )}

      {/* Metadata */}
      {metadata &&
        (metadata.vendor || metadata.po_number || metadata.ship_date) && (
          <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl">
            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
              Document Info
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              {metadata.vendor && (
                <div>
                  <span className="text-[var(--text-muted)]">Vendor:</span>{' '}
                  <span className="font-medium text-[var(--text-primary)]">{metadata.vendor}</span>
                </div>
              )}
              {metadata.po_number && (
                <div>
                  <span className="text-[var(--text-muted)]">PO #:</span>{' '}
                  <span className="font-medium text-[var(--accent-primary)] font-mono">{metadata.po_number}</span>
                </div>
              )}
              {metadata.ship_date && (
                <div>
                  <span className="text-[var(--text-muted)]">Ship Date:</span>{' '}
                  <span className="font-medium text-[var(--text-primary)]">{metadata.ship_date}</span>
                </div>
              )}
            </div>
            {metadata.notes && (
              <p className="text-sm text-[var(--accent-warning)] mt-3 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {metadata.notes}
              </p>
            )}
          </div>
        )}

      {/* Parsed Items Form */}
      {parsedItems.length > 0 && (
        <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
          <div className="bg-[var(--bg-elevated)] px-4 py-3 border-b border-[var(--border-primary)]">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              Review Items ({parsedItems.length})
            </h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Edit or remove items before submitting
            </p>
          </div>

          <div className="divide-y divide-[var(--border-primary)]">
            {parsedItems.map((item, index) => (
              <div
                key={item.id}
                className="p-4 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors animate-slide-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start gap-4">
                  {/* Item ID */}
                  <div className="w-48 shrink-0">
                    <label className="text-xs text-[var(--text-muted)] block mb-1">
                      Item ID
                    </label>
                    <input
                      type="text"
                      value={item.item_id}
                      onChange={(e) =>
                        handleItemChange(item.id, 'item_id', e.target.value)
                      }
                      className="w-full px-3 py-2 text-sm font-mono"
                      placeholder="Part number"
                    />
                  </div>
                  {/* Qty */}
                  <div className="w-20 shrink-0">
                    <label className="text-xs text-[var(--text-muted)] block mb-1">
                      Qty
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={(e) =>
                        handleItemChange(item.id, 'qty', e.target.value)
                      }
                      className="w-full px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  {/* Description & Confidence */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-[var(--text-muted)]">
                        Description
                      </label>
                      {getConfidenceBadge(item.confidence)}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] truncate" title={item.description || ''}>
                      {item.description || '—'}
                    </p>
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="p-2 text-[var(--text-muted)] hover:text-[var(--accent-danger)] hover:bg-[var(--accent-danger-dim)] rounded-lg transition-colors shrink-0 mt-5"
                    title="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 bg-[var(--bg-elevated)] border-t border-[var(--border-primary)] flex items-center justify-between">
            <button
              onClick={handleAddItem}
              className="text-sm text-[var(--accent-primary)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add item
            </button>

            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--text-muted)]">
                Total: <span className="font-mono font-bold text-[var(--accent-primary)]">{parsedItems.reduce((sum, item) => sum + item.qty, 0)}</span>{' '}
                units
              </span>
              <button
                onClick={handleSubmit}
                disabled={submitMutation.isPending || parsedItems.length === 0}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Submit Intake
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Result */}
      {submitResult && (
        <div
          className={`p-4 rounded-xl flex items-start gap-3 ${
            submitResult.success
              ? 'bg-[var(--accent-success-dim)] border border-[var(--accent-success)]'
              : 'bg-[var(--accent-danger-dim)] border border-[var(--accent-danger)]'
          }`}
        >
          {submitResult.success ? (
            <Check className="h-5 w-5 text-[var(--accent-success)] flex-shrink-0 mt-0.5" />
          ) : (
            <X className="h-5 w-5 text-[var(--accent-danger)] flex-shrink-0 mt-0.5" />
          )}
          <p
            className={`text-sm font-medium ${
              submitResult.success ? 'text-[var(--accent-success)]' : 'text-[var(--accent-danger)]'
            }`}
          >
            {submitResult.message}
          </p>
        </div>
      )}

      {/* Full-screen submit success animation */}
      {showSubmitSuccess && submittedData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="relative">
            {/* Pulsing rings */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute w-80 h-80 rounded-full border-2 border-[var(--accent-success)] animate-ping-slow opacity-30" />
              <div className="absolute w-64 h-64 rounded-full border-2 border-[var(--accent-success)] animate-ping-slower opacity-40" />
            </div>

            {/* Main card */}
            <div className="relative bg-gradient-to-br from-[var(--accent-success)] to-emerald-600 rounded-2xl p-8 shadow-2xl animate-bounce-in max-w-sm glow-green">
              <div className="flex justify-center mb-4">
                <div className="relative bg-white/20 rounded-full p-4">
                  <PackageCheck className="h-16 w-16 text-white" />
                  <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white text-center mb-2">
                Inventory Updated!
              </h3>
              <p className="text-white/80 text-center text-sm mb-6">
                Packing slip processed successfully
              </p>

              <div className="flex gap-6 justify-center">
                <div className="text-center">
                  <p className="text-4xl font-bold text-white font-mono">{submittedData.items}</p>
                  <p className="text-sm text-white/70">Items</p>
                </div>
                <div className="w-px bg-white/30" />
                <div className="text-center">
                  <p className="text-4xl font-bold text-white font-mono">{submittedData.qty}</p>
                  <p className="text-sm text-white/70">Total Units</p>
                </div>
              </div>

              <p className="text-white/60 text-sm mt-6 text-center animate-pulse">
                Returning to camera...
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

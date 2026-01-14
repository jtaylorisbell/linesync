import { useQuery } from '@tanstack/react-query';
import {
  Package,
  AlertTriangle,
  Clock,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  TrendingDown,
  Activity,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../api/client';

// Stock status thresholds
const CRITICAL_THRESHOLD = 5;
const LOW_THRESHOLD = 15;

type StockStatus = 'critical' | 'low' | 'ok';

function getStockStatus(qty: number, belowReorder: boolean): StockStatus {
  if (qty <= CRITICAL_THRESHOLD || (belowReorder && qty <= 10)) return 'critical';
  if (qty <= LOW_THRESHOLD || belowReorder) return 'low';
  return 'ok';
}

function StockStatusBadge({ status }: { status: StockStatus }) {
  const config = {
    critical: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      label: 'Critical',
      icon: AlertCircle,
    },
    low: {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      label: 'Low',
      icon: AlertTriangle,
    },
    ok: {
      bg: 'bg-green-100',
      text: 'text-green-700',
      label: 'OK',
      icon: CheckCircle2,
    },
  };

  const { bg, text, label, icon: Icon } = config[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: 'blue' | 'red' | 'green' | 'amber';
  subtitle?: string;
}) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    red: 'bg-red-100 text-red-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(ts: string | null): string {
  if (!ts) return '-';
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return '-';
  }
}

function calculateConsumptionRate(intake: number, consume: number): string {
  if (consume === 0) return '-';
  // Simple rate based on total consumption (in a real app, you'd calculate per hour/day)
  const rate = consume / Math.max(intake, 1);
  if (rate > 0.8) return 'High';
  if (rate > 0.5) return 'Medium';
  return 'Low';
}

export function InventoryPage() {
  const {
    data: inventory,
    isLoading: inventoryLoading,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api.listInventory(),
    refetchInterval: 5000,
  });

  const { data: signals } = useQuery({
    queryKey: ['signals'],
    queryFn: () => api.listSignals({ status: 'OPEN' }),
    refetchInterval: 5000,
  });

  const { data: recentEvents } = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: () => api.getRecentEvents(15),
    refetchInterval: 5000,
  });

  // Calculate summary stats
  const totalItems = inventory?.total_items || 0;
  const criticalItems = inventory?.items.filter(
    (i) => getStockStatus(i.on_hand_qty, i.below_reorder_point) === 'critical'
  ).length || 0;
  const lowItems = inventory?.items.filter(
    (i) => getStockStatus(i.on_hand_qty, i.below_reorder_point) === 'low'
  ).length || 0;
  const openSignals = signals?.total_open || 0;
  const todayScans = recentEvents?.events.length || 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Package className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Inventory Dashboard</h2>
            <p className="text-gray-500">Real-time inventory levels and activity</p>
          </div>
        </div>
        <button
          onClick={() => refetchInventory()}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          title="Total SKUs"
          value={totalItems}
          icon={Package}
          color="blue"
        />
        <SummaryCard
          title="Critical Items"
          value={criticalItems}
          icon={AlertCircle}
          color="red"
          subtitle={criticalItems > 0 ? 'Needs attention' : 'All good'}
        />
        <SummaryCard
          title="Low Stock"
          value={lowItems}
          icon={TrendingDown}
          color="amber"
        />
        <SummaryCard
          title="Open Signals"
          value={openSignals}
          icon={AlertTriangle}
          color={openSignals > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inventory Table */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Package className="h-5 w-5 text-gray-600" />
            <h3 className="font-semibold">Current Inventory</h3>
            {inventory && (
              <span className="ml-auto text-sm text-gray-500">
                {inventory.total_items} items
              </span>
            )}
          </div>
          <div className="overflow-auto max-h-[55vh]">
            {inventoryLoading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : inventory?.items.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No inventory data. Start scanning items!
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">
                      Item ID
                    </th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-600">
                      Status
                    </th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                      On Hand
                    </th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-600">
                      In / Out
                    </th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-600">
                      Velocity
                    </th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inventory?.items.map((item) => {
                    const status = getStockStatus(item.on_hand_qty, item.below_reorder_point);
                    const velocity = calculateConsumptionRate(item.intake_total, item.consume_total);

                    return (
                      <tr
                        key={item.item_id}
                        className={
                          status === 'critical'
                            ? 'bg-red-50'
                            : status === 'low'
                            ? 'bg-amber-50/50'
                            : ''
                        }
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {item.item_id}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StockStatusBadge status={status} />
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono text-lg ${
                            status === 'critical'
                              ? 'text-red-600 font-bold'
                              : status === 'low'
                              ? 'text-amber-600 font-semibold'
                              : 'text-gray-900'
                          }`}
                        >
                          {item.on_hand_qty}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-green-600 font-mono">+{item.intake_total}</span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="text-red-600 font-mono">-{item.consume_total}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${
                              velocity === 'High'
                                ? 'text-red-600'
                                : velocity === 'Medium'
                                ? 'text-amber-600'
                                : 'text-gray-500'
                            }`}
                          >
                            <Activity className="h-3 w-3" />
                            {velocity}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-500">
                          {formatRelativeTime(item.last_activity_ts)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar: Signals & Activity */}
        <div className="space-y-6">
          {/* Replenishment Signals */}
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold">Replenishment Signals</h3>
              {signals && signals.total_open > 0 && (
                <span className="ml-auto px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                  {signals.total_open} open
                </span>
              )}
            </div>
            <div className="p-4 space-y-3 max-h-[280px] overflow-auto">
              {signals?.signals.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No open signals</p>
                  <p className="text-gray-400 text-xs">All items stocked</p>
                </div>
              ) : (
                signals?.signals.map((signal) => (
                  <div
                    key={signal.signal_id}
                    className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-800">
                        {signal.item_id}
                      </span>
                      <span className="text-xs text-amber-600">
                        {formatRelativeTime(signal.created_ts)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-sm">
                      <div>
                        <span className="text-amber-600">Current:</span>
                        <span className="ml-1 font-mono font-bold text-red-600">
                          {signal.current_qty}
                        </span>
                      </div>
                      <div>
                        <span className="text-amber-600">Reorder:</span>
                        <span className="ml-1 font-mono text-amber-800">
                          {signal.reorder_qty}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Clock className="h-5 w-5 text-gray-600" />
              <h3 className="font-semibold">Recent Activity</h3>
              <span className="ml-auto text-xs text-gray-400">
                {todayScans} scans
              </span>
            </div>
            <div className="p-4 space-y-2 max-h-[280px] overflow-auto">
              {recentEvents?.events.length === 0 ? (
                <div className="text-center py-6">
                  <Activity className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No recent activity</p>
                  <p className="text-gray-400 text-xs">Start scanning items</p>
                </div>
              ) : (
                recentEvents?.events.map((event) => (
                  <div
                    key={event.event_id}
                    className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0"
                  >
                    <div
                      className={`p-1 rounded ${
                        event.event_type === 'INTAKE'
                          ? 'bg-green-100'
                          : 'bg-red-100'
                      }`}
                    >
                      {event.event_type === 'INTAKE' ? (
                        <ArrowDown className="h-3 w-3 text-green-600" />
                      ) : (
                        <ArrowUp className="h-3 w-3 text-red-600" />
                      )}
                    </div>
                    <span className="font-medium truncate flex-1">
                      {event.item_id}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        event.event_type === 'INTAKE'
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {event.event_type === 'INTAKE' ? '+' : '-'}
                      {event.qty}
                    </span>
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      {formatRelativeTime(event.event_ts)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

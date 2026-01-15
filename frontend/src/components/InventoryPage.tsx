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
  Boxes,
  Bell,
  Sparkles,
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
      classes: 'badge-danger',
      label: 'Critical',
      icon: AlertCircle,
    },
    low: {
      classes: 'badge-warning',
      label: 'Low',
      icon: AlertTriangle,
    },
    ok: {
      classes: 'badge-success',
      label: 'OK',
      icon: CheckCircle2,
    },
  };

  const { classes, label, icon: Icon } = config[status];

  return (
    <span className={`badge ${classes}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  variant = 'default',
  subtitle,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  subtitle?: string;
  trend?: 'up' | 'down';
}) {
  const variantClasses = {
    default: 'stat-card',
    success: 'stat-card stat-card-success',
    warning: 'stat-card stat-card-warning',
    danger: 'stat-card stat-card-danger',
  };

  const iconColors = {
    default: 'text-[var(--accent-primary)]',
    success: 'text-[var(--accent-success)]',
    warning: 'text-[var(--accent-warning)]',
    danger: 'text-[var(--accent-danger)]',
  };

  return (
    <div className={`${variantClasses[variant]} p-5 transition-all duration-300 hover:scale-[1.02]`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--text-muted)] uppercase tracking-wide font-medium">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-3xl font-bold text-[var(--text-primary)] animate-count">{value}</p>
            {trend && (
              <span className={trend === 'up' ? 'text-[var(--accent-success)]' : 'text-[var(--accent-danger)]'}>
                {trend === 'up' ? <TrendingDown className="h-4 w-4 rotate-180" /> : <TrendingDown className="h-4 w-4" />}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl bg-[var(--bg-elevated)] ${iconColors[variant]}`}>
          <Icon className="h-6 w-6" />
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

  // Create inventory lookup map for live current_qty in signals
  const inventoryMap = new Map(
    inventory?.items.map((item) => [item.item_id, item.on_hand_qty]) || []
  );

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text-primary)]">
            Inventory Dashboard
          </h2>
          <p className="text-[var(--text-muted)] mt-1">
            Real-time view of all parts and materials
          </p>
        </div>
        <button
          onClick={() => refetchInventory()}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Parts"
          value={totalItems}
          icon={Boxes}
          subtitle="Unique SKUs tracked"
        />
        <StatCard
          title="Critical Stock"
          value={criticalItems}
          icon={AlertCircle}
          variant={criticalItems > 0 ? 'danger' : 'default'}
          subtitle="Need immediate attention"
        />
        <StatCard
          title="Low Stock"
          value={lowItems}
          icon={AlertTriangle}
          variant={lowItems > 0 ? 'warning' : 'default'}
          subtitle="Below reorder point"
        />
        <StatCard
          title="Open Signals"
          value={openSignals}
          icon={Bell}
          variant={openSignals > 0 ? 'warning' : 'success'}
          subtitle="Pending replenishment"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Inventory Table - 2 columns */}
        <div className="col-span-2 card-dark overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-[var(--accent-primary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Current Inventory</h3>
            </div>
            <span className="text-sm text-[var(--text-muted)]">{totalItems} items</span>
          </div>

          <div className="max-h-[500px] overflow-auto">
            {inventoryLoading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="h-8 w-8 text-[var(--accent-primary)] animate-spin" />
              </div>
            ) : inventory?.items.length === 0 ? (
              <div className="text-center py-20">
                <Boxes className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-[var(--text-secondary)]">No inventory yet</p>
                <p className="text-sm text-[var(--text-muted)]">Start by scanning items in the Receive tab</p>
              </div>
            ) : (
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>Part Number</th>
                    <th>On Hand</th>
                    <th>Status</th>
                    <th>In / Out</th>
                    <th>Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory?.items.map((item, index) => {
                    const status = getStockStatus(item.on_hand_qty, item.below_reorder_point);
                    return (
                      <tr
                        key={item.item_id}
                        className="animate-slide-in"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <td>
                          <span className="font-mono font-semibold text-[var(--text-primary)]">
                            {item.item_id}
                          </span>
                        </td>
                        <td>
                          <span className={`font-mono text-lg font-bold ${
                            status === 'critical' ? 'text-[var(--accent-danger)]' :
                            status === 'low' ? 'text-[var(--accent-warning)]' :
                            'text-[var(--accent-success)]'
                          }`}>
                            {item.on_hand_qty}
                          </span>
                        </td>
                        <td>
                          <StockStatusBadge status={status} />
                        </td>
                        <td>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="flex items-center gap-1 text-[var(--accent-success)]">
                              <ArrowDown className="h-3 w-3" />
                              {item.intake_total}
                            </span>
                            <span className="flex items-center gap-1 text-[var(--accent-danger)]">
                              <ArrowUp className="h-3 w-3" />
                              {item.consume_total}
                            </span>
                          </div>
                        </td>
                        <td className="text-[var(--text-muted)] text-sm">
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

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Replenishment Signals */}
          <div className="card-dark overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-[var(--accent-warning)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Replenishment Signals</h3>
              </div>
              {signals && signals.total_open > 0 && (
                <span className="badge badge-warning">
                  {signals.total_open} open
                </span>
              )}
            </div>
            <div className="p-4 space-y-3 max-h-[280px] overflow-auto">
              {signals?.signals.length === 0 ? (
                <div className="text-center py-8">
                  <div className="relative inline-block">
                    <CheckCircle2 className="h-10 w-10 text-[var(--accent-success)]" />
                    <Sparkles className="h-4 w-4 text-[var(--accent-success)] absolute -top-1 -right-1" />
                  </div>
                  <p className="text-[var(--text-secondary)] mt-3">All stocked</p>
                  <p className="text-xs text-[var(--text-muted)]">No signals pending</p>
                </div>
              ) : (
                signals?.signals.map((signal, index) => (
                  <div
                    key={signal.signal_id}
                    className="p-4 bg-[var(--accent-warning-dim)] border border-[var(--accent-warning)] rounded-xl animate-slide-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold text-[var(--accent-warning)]">
                        {signal.item_id}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatRelativeTime(signal.created_ts)}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-[var(--text-muted)]">Current</span>
                        <span className="ml-2 font-mono font-bold text-[var(--accent-danger)]">
                          {inventoryMap.get(signal.item_id) ?? signal.current_qty}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Reorder</span>
                        <span className="ml-2 font-mono font-bold text-[var(--text-primary)]">
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
          <div className="card-dark overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-[var(--accent-primary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Recent Activity</h3>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{todayScans} events</span>
            </div>
            <div className="p-4 space-y-2 max-h-[280px] overflow-auto">
              {recentEvents?.events.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-10 w-10 text-[var(--text-muted)] mx-auto" />
                  <p className="text-[var(--text-secondary)] mt-3">No recent activity</p>
                  <p className="text-xs text-[var(--text-muted)]">Start scanning items</p>
                </div>
              ) : (
                recentEvents?.events.map((event, index) => (
                  <div
                    key={event.event_id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors animate-slide-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div
                      className={`p-2 rounded-lg ${
                        event.event_type === 'INTAKE'
                          ? 'bg-[var(--accent-success-dim)]'
                          : 'bg-[var(--accent-danger-dim)]'
                      }`}
                    >
                      {event.event_type === 'INTAKE' ? (
                        <ArrowDown className="h-3 w-3 text-[var(--accent-success)]" />
                      ) : (
                        <ArrowUp className="h-3 w-3 text-[var(--accent-danger)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm font-medium text-[var(--text-primary)] truncate block">
                        {event.item_id}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatRelativeTime(event.event_ts)}
                      </span>
                    </div>
                    <span className={`font-mono font-bold ${
                      event.event_type === 'INTAKE'
                        ? 'text-[var(--accent-success)]'
                        : 'text-[var(--accent-danger)]'
                    }`}>
                      {event.event_type === 'INTAKE' ? '+' : '-'}{event.qty}
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

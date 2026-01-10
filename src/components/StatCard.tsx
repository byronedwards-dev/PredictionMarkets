import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'profit' | 'warning' | 'accent';
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: StatCardProps) {
  const variantStyles = {
    default: 'border-terminal-border',
    profit: 'border-profit-low/30 glow-profit',
    warning: 'border-accent-amber/30 glow-warning',
    accent: 'border-accent-cyan/30 glow-accent',
  };

  const valueStyles = {
    default: 'text-white',
    profit: 'text-profit-low',
    warning: 'text-accent-amber',
    accent: 'text-accent-cyan',
  };

  return (
    <div
      className={cn(
        'card p-4 transition-all hover:bg-terminal-hover',
        variantStyles[variant],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="stat-label">{title}</p>
          <p className={cn('stat-value', valueStyles[variant])}>{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn(
            'p-2 rounded-lg',
            variant === 'profit' ? 'bg-profit-low/10' :
            variant === 'warning' ? 'bg-accent-amber/10' :
            variant === 'accent' ? 'bg-accent-cyan/10' :
            'bg-terminal-hover'
          )}>
            <Icon className={cn(
              'w-5 h-5',
              variant === 'profit' ? 'text-profit-low' :
              variant === 'warning' ? 'text-accent-amber' :
              variant === 'accent' ? 'text-accent-cyan' :
              'text-gray-400'
            )} />
          </div>
        )}
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          <span className={trend.value >= 0 ? 'text-profit-low' : 'text-loss-low'}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value).toFixed(1)}%
          </span>
          <span className="text-gray-500">{trend.label}</span>
        </div>
      )}
    </div>
  );
}

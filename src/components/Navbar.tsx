'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, 
  TrendingUp, 
  BarChart3, 
  Settings,
  Activity,
  GitCompare,
  Vote
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/markets', label: 'Markets', icon: TrendingUp },
  { href: '/pairs', label: 'Pairs', icon: GitCompare },
  { href: '/discover', label: 'Elections', icon: Vote },
  { href: '/arbs', label: 'Arbitrage', icon: BarChart3 },
  { href: '/volume', label: 'Volume Alerts', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-terminal-border bg-terminal-bg/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-cyan to-accent-purple flex items-center justify-center">
              <span className="text-white font-bold text-sm">PM</span>
            </div>
            <span className="font-display font-semibold text-lg text-white">
              Prediction Market Scanner
            </span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    isActive
                      ? 'bg-accent-cyan/20 text-accent-cyan'
                      : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-profit-low animate-pulse" />
            <span className="text-gray-400">Live</span>
          </div>
        </div>
      </div>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, 
  TrendingUp, 
  BarChart3, 
  Settings,
  GitCompare,
  Layers,
  ChevronDown
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/markets', label: 'Markets', icon: TrendingUp },
  { href: '/pairs', label: 'Cross-Platform', icon: GitCompare },
  { 
    label: 'Arbitrage', 
    icon: BarChart3,
    children: [
      { href: '/arbs', label: 'Cross-Platform Arbs', icon: GitCompare },
      { href: '/arbs/single-platform', label: 'Single-Platform Arbs', icon: Layers },
    ]
  },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();
  const [arbDropdownOpen, setArbDropdownOpen] = useState(false);

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
              // Handle dropdown items
              if ('children' in item && item.children) {
                const isAnyChildActive = item.children.some(child => pathname === child.href || pathname.startsWith(child.href + '/'));
                const Icon = item.icon;
                
                return (
                  <div key={item.label} className="relative">
                    <button
                      onClick={() => setArbDropdownOpen(!arbDropdownOpen)}
                      onBlur={() => setTimeout(() => setArbDropdownOpen(false), 150)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                        isAnyChildActive
                          ? 'bg-accent-cyan/20 text-accent-cyan'
                          : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                      <ChevronDown className={cn(
                        'w-3 h-3 transition-transform',
                        arbDropdownOpen && 'rotate-180'
                      )} />
                    </button>
                    
                    {arbDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 py-1 min-w-[200px] rounded-lg bg-terminal-card border border-terminal-border shadow-lg">
                        {item.children.map((child) => {
                          const isChildActive = pathname === child.href;
                          const ChildIcon = child.icon;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                'flex items-center gap-2 px-4 py-2 text-sm transition-all',
                                isChildActive
                                  ? 'bg-accent-cyan/20 text-accent-cyan'
                                  : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
                              )}
                            >
                              <ChildIcon className="w-4 h-4" />
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              
              // Regular nav item
              const isActive = pathname === item.href;
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href!}
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

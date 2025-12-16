/**
 * Tab Workflow Component - Breadcrumb-style horizontal navigation
 * Supports active state, badges, and disabled tabs
 * v0.1.0 (31-10)
 */
import { ChevronRight } from 'lucide-react';

export interface Tab {
  id: string;
  label: string;
  badge?: number;
  disabled?: boolean;
}

export interface TabWorkflowProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabWorkflow({ tabs, activeTab, onTabChange }: TabWorkflowProps) {
  return (
    <div className="w-full bg-white border-b border-gray-200">
      <div className="flex items-center h-12 px-6 gap-2">
        {tabs.map((tab, index) => (
          <div key={tab.id} className="flex items-center gap-2">
            <button
              onClick={() => !tab.disabled && onTabChange(tab.id)}
              disabled={tab.disabled}
              className={`
                relative px-3 py-2 text-sm font-medium transition-colors
                ${tab.id === activeTab
                  ? 'text-blue-600'
                  : tab.disabled
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded'
                }
              `}
            >
              <span className="flex items-center gap-2">
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-white bg-blue-600 rounded-full">
                    {tab.badge}
                  </span>
                )}
              </span>
              {tab.id === activeTab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
              )}
            </button>
            {index < tabs.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-300" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

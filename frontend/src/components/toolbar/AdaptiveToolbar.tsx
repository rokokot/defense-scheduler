/**
 * Adaptive Toolbar - Horizontal toolbar that can snap to right side
 * v0.2.0 (02-11) - Streamlined toolbar with filter, data dropdown, and delete
 */
import {
  Plus,
  Play,
  RefreshCw,
  ChevronDown,
  Settings,
  Upload,
  Download,
  Save,
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Info,
  Filter as FilterIcon,
  GripVertical,
  Database,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  Layers,
  X,
  CalendarX,
  Loader2,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export type CardViewMode = 'individual' | 'compact';

export interface AdaptiveToolbarProps {
  position?: 'top' | 'right';
  onPositionChange?: (position: 'top' | 'right') => void;
  onToggleFilterSidebar?: () => void;
  onShowUnscheduled?: () => void;
  unscheduledCount?: number;
  onAddDefence?: () => void;
  onGenerateSchedule?: () => void;
  onReoptimize?: () => void;
  onQuickSolve?: (preset: 'fast' | 'optimal' | 'enumerate') => void;
  onSolverSettings?: () => void;
  onImportData?: () => void;
  onExportResults?: () => void;
  onSaveSnapshot?: () => void;
  onLoadSnapshot?: () => void;
  onShowConflicts?: () => void;
  onValidateSchedule?: () => void;
  onViewStatistics?: () => void;
  onExplainInfeasibility?: () => void;
  onDeleteSelection?: () => void;
  onDeleteAll?: () => void;
  onUnscheduleSelection?: () => void;
  onUnscheduleAll?: () => void;
  selectedCount?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  // View mode
  cardViewMode?: CardViewMode;
  onCardViewModeChange?: (mode: CardViewMode) => void;
  // Roster management
  rosters?: Array<{ id: string; label: string }>;
  activeRosterId?: string;
  onRosterSelect?: (rosterId: string) => void;
  onRosterDelete?: (rosterId: string) => void;
  onRosterRename?: (rosterId: string, newLabel: string) => void;
  onNewRoster?: () => void;
  onCompareToggle?: () => void;
  compareMode?: boolean;
  isSolving?: boolean;
}

export function AdaptiveToolbar({
  position = 'top',
  onPositionChange,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  cardViewMode = 'individual',
  onCardViewModeChange,
  onToggleFilterSidebar,
  onShowUnscheduled,
  unscheduledCount = 0,
  onAddDefence,
  onGenerateSchedule,
  onReoptimize,
  onQuickSolve,
  onSolverSettings,
  onImportData,
  onExportResults,
  onSaveSnapshot,
  onLoadSnapshot,
  onShowConflicts,
  onValidateSchedule,
  onViewStatistics,
  onExplainInfeasibility,
  onDeleteSelection,
  onDeleteAll,
  onUnscheduleSelection,
  onUnscheduleAll,
  selectedCount = 0,
  rosters = [],
  activeRosterId,
  onRosterSelect,
  onRosterDelete,
  onRosterRename,
  onNewRoster,
  onCompareToggle,
  compareMode = false,
  isSolving = false,
}: AdaptiveToolbarProps) {
  const [solveMenuOpen, setSolveMenuOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ rosterId: string; rosterLabel: string } | null>(null);
  const [editingRosterId, setEditingRosterId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string>('');
  const [unscheduleMenuOpen, setUnscheduleMenuOpen] = useState(false);

  const solveRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);
  const unscheduleRef = useRef<HTMLDivElement>(null);

  const togglePosition = () => {
    onPositionChange?.(position === 'top' ? 'right' : 'top');
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (solveRef.current && !solveRef.current.contains(event.target as Node)) {
        setSolveMenuOpen(false);
      }
      if (dataRef.current && !dataRef.current.contains(event.target as Node)) {
        setDataMenuOpen(false);
      }
      if (deleteRef.current && !deleteRef.current.contains(event.target as Node)) {
        setDeleteMenuOpen(false);
      }
      if (unscheduleRef.current && !unscheduleRef.current.contains(event.target as Node)) {
        setUnscheduleMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (position === 'right') {
    return (
      <div
        className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-3 overflow-y-auto"
        data-prevent-clear="true"
      >
        {/* Position Toggle */}
        <button
          onClick={togglePosition}
          className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Snap to top"
        >
          <GripVertical className="w-5 h-5" />
        </button>

        <div className="w-8 border-t border-gray-200" />

        {/* Filter */}
        <button
          onClick={onToggleFilterSidebar}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Toggle filters"
        >
          <FilterIcon className="w-5 h-5" />
        </button>

        <div className="w-8 border-t border-gray-200" />

        {/* Undo/Redo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2 rounded transition-colors ${
            canUndo
              ? 'text-gray-700 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="Undo"
        >
          <Undo2 className="w-5 h-5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2 rounded transition-colors ${
            canRedo
              ? 'text-gray-700 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="Redo"
        >
          <Redo2 className="w-5 h-5" />
        </button>

        {/* View Mode Toggle */}
        {onCardViewModeChange && (
          <button
            onClick={() => onCardViewModeChange(cardViewMode === 'individual' ? 'compact' : 'individual')}
            className={`p-2 rounded transition-colors ${
              cardViewMode === 'compact'
                ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            title={cardViewMode === 'individual' ? 'Compact view' : 'Individual view'}
          >
            {cardViewMode === 'individual' ? (
              <Layers className="w-5 h-5" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </button>
        )}

        {/* Core Actions */}
        <button
          onClick={onShowUnscheduled}
          className="relative p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="View all events"
        >
          <Layers className="w-5 h-5" />
          {unscheduledCount > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-xs font-medium bg-blue-500 text-white rounded-full">
              {unscheduledCount}
            </span>
          )}
        </button>

        <button
          onClick={onAddDefence}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Add defense"
        >
          <Plus className="w-5 h-5" />
        </button>

        <button
          onClick={onGenerateSchedule}
          className="p-2 text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          title="Solve"
        >
          <Play className="w-5 h-5" />
        </button>

        <button
          onClick={onReoptimize}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Re-optimize"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        <div className="relative" ref={unscheduleRef}>
          <button
            onClick={() => setUnscheduleMenuOpen(open => !open)}
            className="p-2 text-orange-600 hover:bg-orange-50 rounded transition-colors relative"
            title="Unschedule actions"
          >
            <CalendarX className="w-5 h-5" />
            {selectedCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1 text-[10px] bg-orange-600 text-white rounded-full min-w-[16px] text-center">
                {selectedCount}
              </span>
            )}
          </button>
          {unscheduleMenuOpen && (
            <div className="absolute left-full top-0 ml-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
              <div className="py-1 text-left text-xs">
                <button
                  onClick={() => {
                    if (selectedCount > 0) {
                      onUnscheduleSelection?.();
                    }
                    setUnscheduleMenuOpen(false);
                  }}
                  disabled={!onUnscheduleSelection || selectedCount === 0}
                  className={`w-full px-3 py-1.5 text-left ${
                    selectedCount > 0 && onUnscheduleSelection
                      ? 'text-gray-900 hover:bg-gray-100'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Unschedule selected ({selectedCount})
                </button>
                <button
                  onClick={() => {
                    onUnscheduleAll?.();
                    setUnscheduleMenuOpen(false);
                  }}
                  disabled={!onUnscheduleAll}
                  className={`w-full px-3 py-1.5 text-left ${
                    onUnscheduleAll ? 'text-gray-900 hover:bg-gray-100' : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Unschedule all defenses
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Roster management */}
        <button
          onClick={onNewRoster}
          className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors text-xs"
          title="New roster"
        >
          <Copy className="w-4 h-4" />
        </button>

        <button
          onClick={onCompareToggle}
          className={`p-1.5 rounded transition-colors text-xs ${
            compareMode
              ? 'text-white bg-blue-600 hover:bg-blue-700'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          title={`Compare rosters ${rosters && rosters.length > 1 ? `(${rosters.length})` : ''}`}
        >
          <Layers className="w-4 h-4" />
        </button>

        <div className="w-8 border-t border-gray-200" />

        {/* Data */}
        <button
          onClick={onImportData}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Data"
        >
          <Database className="w-5 h-5" />
        </button>

        <div className="w-8 border-t border-gray-200" />

        {/* Analysis */}
        <button
          onClick={onShowConflicts}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Show conflicts"
        >
          <AlertTriangle className="w-5 h-5" />
        </button>

        <button
          onClick={onValidateSchedule}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Validate schedule"
        >
          <CheckCircle className="w-5 h-5" />
        </button>

        <button
          onClick={onViewStatistics}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="View statistics"
        >
          <BarChart3 className="w-5 h-5" />
        </button>

        <button
          onClick={onExplainInfeasibility}
          className="p-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Explain infeasibility"
        >
          <Info className="w-5 h-5" />
        </button>

        <div className="w-8 border-t border-gray-200" />

        {/* Delete */}
        <button
          onClick={() => setDeleteMenuOpen(!deleteMenuOpen)}
          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
          title="Delete"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Horizontal (top) layout
  return (
    <div
      className="bg-white border-b border-gray-200 px-2 sm:px-4 py-1.5 sm:py-2"
      data-prevent-clear="true"
    >
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Position Toggle */}
        <button
          onClick={togglePosition}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Snap to right side"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Filter Button */}
        <div className="pr-2 sm:pr-4 border-r border-gray-200">
          <button
            onClick={onToggleFilterSidebar}
            className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            title="Toggle filter sidebar"
          >
            <FilterIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>

        {/* Undo/Redo */}
        <div className="flex items-center gap-1 pr-4 border-r border-gray-200">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded transition-colors ${
              canUndo
                ? 'text-gray-700 hover:bg-gray-100'
                : 'text-gray-300 cursor-not-allowed'
            }`}
            title="Undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded transition-colors ${
              canRedo
                ? 'text-gray-700 hover:bg-gray-100'
                : 'text-gray-300 cursor-not-allowed'
            }`}
            title="Redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          {/* View Mode Toggle */}
          {onCardViewModeChange && (
            <button
              onClick={() => onCardViewModeChange(cardViewMode === 'individual' ? 'compact' : 'individual')}
              className={`p-1.5 rounded transition-colors ${
                cardViewMode === 'compact'
                  ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={cardViewMode === 'individual' ? 'Compact view' : 'Individual view'}
            >
              {cardViewMode === 'individual' ? (
                <Layers className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Core Actions */}
        <div className="flex items-center gap-1.5 pr-4 border-r border-gray-200">
          <button
            onClick={onShowUnscheduled}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            title="View all events"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Events</span>
            {unscheduledCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                {unscheduledCount}
              </span>
            )}
          </button>

          <button
            onClick={onAddDefence}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            title="Add new defense"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>

          <div className="relative flex items-center" ref={solveRef}>
            <button
              onClick={onGenerateSchedule}
              disabled={isSolving}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 text-xs font-medium text-white rounded-l ${isSolving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
              title="Solve schedule"
            >
              {isSolving ? (
                <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
              ) : (
                <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              )}
              <span className="hidden sm:inline">{isSolving ? 'Solving...' : 'Solve'}</span>
            </button>
            <button
              onClick={() => setSolveMenuOpen(open => !open)}
              disabled={isSolving}
              className={`px-1.5 py-1 text-xs font-medium text-white rounded-r border-l border-blue-700 ${isSolving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
              aria-label="Solver options"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            {solveMenuOpen && !isSolving && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                <div className="py-1">
                  <button
                    onClick={() => {
                      onQuickSolve?.('fast');
                      setSolveMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <div className="font-medium">Fast</div>
                    <div className="text-xs text-gray-500">Quick solution</div>
                  </button>
                  <button
                    onClick={() => {
                      onQuickSolve?.('optimal');
                      setSolveMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <div className="font-medium">Optimal</div>
                    <div className="text-xs text-gray-500">Best quality</div>
                  </button>
                  <button
                    onClick={() => {
                      onQuickSolve?.('enumerate');
                      setSolveMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <div className="font-medium">Enumerate</div>
                    <div className="text-xs text-gray-500">Multiple solutions</div>
                  </button>
                  <div className="border-t border-gray-200 my-1" />
                  <button
                    onClick={() => {
                      onSolverSettings?.();
                      setSolveMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Solver Settings</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onReoptimize}
            disabled={isSolving}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-gray-300 rounded transition-colors ${
              isSolving ? 'text-gray-400 bg-gray-100 cursor-not-allowed' : 'text-gray-700 bg-white hover:bg-gray-50'
            }`}
            title="Re-optimize existing schedule"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-optimize</span>
          </button>

          {/* Roster view buttons */}
          {rosters.length > 0 && (
            <div className="flex items-center gap-1 px-3 border-l border-gray-200">
              {rosters.map((roster) => (
                <div key={roster.id} className="group flex items-center">
                  {editingRosterId === roster.id ? (
                    <input
                      type="text"
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onBlur={() => {
                        if (editingLabel.trim()) {
                          onRosterRename?.(roster.id, editingLabel.trim());
                        }
                        setEditingRosterId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingLabel.trim()) {
                            onRosterRename?.(roster.id, editingLabel.trim());
                          }
                          setEditingRosterId(null);
                        } else if (e.key === 'Escape') {
                          setEditingRosterId(null);
                        }
                      }}
                      autoFocus
                      className="px-2 py-1 text-xs font-medium border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      style={{ width: '120px' }}
                    />
                  ) : (
                    <button
                      onClick={() => onRosterSelect?.(roster.id)}
                      onDoubleClick={() => {
                        setEditingRosterId(roster.id);
                        setEditingLabel(roster.label);
                      }}
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        activeRosterId === roster.id
                          ? 'bg-blue-100 text-blue-700 border border-blue-300'
                          : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <span>{roster.label}</span>
                      {rosters.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm({ rosterId: roster.id, rosterLabel: roster.label });
                          }}
                          className="ml-1 pl-1 border-l border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600"
                          title="Delete schedule"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Roster management */}
          <button
            onClick={onNewRoster}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="New roster"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onCompareToggle}
            className={`p-1.5 rounded transition-colors ${
              compareMode
                ? 'text-white bg-blue-600 hover:bg-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            title="Compare rosters"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Data Management */}
        <div className="flex items-center gap-1.5 pr-4 border-r border-gray-200" ref={dataRef}>
          <div className="relative">
            <button
              onClick={() => setDataMenuOpen(!dataMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              title="Data operations"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Data</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {dataMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                <div className="py-1">
                  <button
                    onClick={() => {
                      onImportData?.();
                      setDataMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Import</span>
                  </button>
                  <button
                    onClick={() => {
                      onExportResults?.();
                      setDataMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export</span>
                  </button>
                  <div className="border-t border-gray-200 my-1" />
                  <button
                    onClick={() => {
                      onSaveSnapshot?.();
                      setDataMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Snapshot</span>
                  </button>
                  <button
                    onClick={() => {
                      onLoadSnapshot?.();
                      setDataMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Load Snapshot</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Analysis & Debugging */}
        <div className="flex items-center gap-1 pr-4 border-r border-gray-200">
          <button
            onClick={onShowConflicts}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Show conflicts"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onValidateSchedule}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Validate schedule"
          >
            <CheckCircle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onViewStatistics}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="View statistics"
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onExplainInfeasibility}
            className="p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Explain infeasibility"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative" ref={unscheduleRef}>
          <button
            onClick={() => setUnscheduleMenuOpen(open => !open)}
            className="p-1.5 text-orange-600 hover:bg-orange-50 rounded transition-colors relative"
            title="Unschedule defenses"
          >
            <CalendarX className="w-3.5 h-3.5" />
            {selectedCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1 text-[10px] bg-orange-600 text-white rounded-full min-w-[16px] text-center">
                {selectedCount}
              </span>
            )}
          </button>
          {unscheduleMenuOpen && (
            <div className="absolute top-full right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50">
              <div className="py-1">
                <button
                  onClick={() => {
                    if (selectedCount > 0) {
                      onUnscheduleSelection?.();
                    }
                    setUnscheduleMenuOpen(false);
                  }}
                  disabled={!onUnscheduleSelection || selectedCount === 0}
                  className={`w-full text-left px-3 py-1.5 text-xs ${
                    onUnscheduleSelection && selectedCount > 0
                      ? 'text-gray-900 hover:bg-gray-100'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Unschedule selected ({selectedCount})
                </button>
                <button
                  onClick={() => {
                    onUnscheduleAll?.();
                    setUnscheduleMenuOpen(false);
                  }}
                  disabled={!onUnscheduleAll}
                  className={`w-full text-left px-3 py-1.5 text-xs ${
                    onUnscheduleAll ? 'text-gray-900 hover:bg-gray-100' : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Unschedule all defenses
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Delete */}
        <div className="relative" ref={deleteRef}>
          <button
            onClick={() => setDeleteMenuOpen(!deleteMenuOpen)}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors relative"
            title="Delete defenses"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {selectedCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1 text-[10px] bg-red-600 text-white rounded-full min-w-[16px] text-center">
                {selectedCount}
              </span>
            )}
          </button>

          {deleteMenuOpen && (
            <div className="absolute top-full right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50">
              <div className="py-1">
                {selectedCount > 0 && (
                  <button
                    onClick={() => {
                      onDeleteSelection?.();
                      setDeleteMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-100"
                  >
                    Delete Selected ({selectedCount})
                  </button>
                )}
                <button
                  onClick={() => {
                    onDeleteAll?.();
                    setDeleteMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-100"
                >
                  Delete All Defenses
                </button>
                {rosters.length > 1 && activeRosterId && (
                  <button
                    onClick={() => {
                      const activeRoster = rosters.find(r => r.id === activeRosterId);
                      if (activeRoster) {
                        setDeleteConfirm({ rosterId: activeRoster.id, rosterLabel: activeRoster.label });
                      }
                      setDeleteMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete Schedule
                  </button>
                )}
                <div className="border-t border-gray-200 my-1" />
                <button
                  onClick={() => setDeleteMenuOpen(false)}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Schedule?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{deleteConfirm.rosterLabel}"? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRosterDelete?.(deleteConfirm.rosterId);
                  setDeleteConfirm(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

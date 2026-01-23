/**
 * Blocking Matrix View - Defense-by-resource matrix with collapsible categories
 * Rows = blocked defenses (students)
 * Columns = blocking resources grouped by type (persons, rooms, time)
 */

import { useState, useCallback, useMemo } from 'react';
import { User, Building2, Clock, ChevronRight } from 'lucide-react';
import { MatrixColumn, MatrixColumnType, BlockingMatrixViewProps } from './types';

const LABEL_WIDTH = 215;
const CELL_WIDTH = 44;
const ROW_HEIGHT = 44;
const DOT_RADIUS = 6;
const EMPTY_RADIUS = 4;
const BAR_HEIGHT = 95;
const BAR_WIDTH = 20;
const HEADER_HEIGHT = 60;
const CATEGORY_WIDTH = 50;

function abbreviateResource(resource: string, type: MatrixColumnType): string {
  if (type === 'room') {
    // Show actual room name
    return resource;
  }
  if (type === 'time') {
    // Rename all_rooms to "add extra day"
    if (resource === 'all_rooms') {
      return 'add extra day';
    }
    return resource;
  }
  if (type === 'person') {
    const parts = resource.trim().split(/\s+/);
    if (parts.length >= 2) {
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      return `${firstName.charAt(0)}. ${lastName}`;
    }
  }
  return resource;
}

const typeConfig: Record<MatrixColumnType, {
  label: string;
  color: string;
  bgColor: string;
  dotColor: string;
  barColor: string;
  icon: typeof User;
}> = {
  person: {
    label: 'Persons',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    dotColor: '#3b82f6',
    barColor: '#3b82f6',
    icon: User,
  },
  room: {
    label: 'Rooms',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    dotColor: '#f59e0b',
    barColor: '#f59e0b',
    icon: Building2,
  },
  time: {
    label: 'Time',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    dotColor: '#9333ea',
    barColor: '#9333ea',
    icon: Clock,
  },
};

interface CategoryState {
  person: boolean;
  room: boolean;
  time: boolean;
}

export function BlockingMatrixView({
  data,
  selection,
  onSelectionChange,
  onRowDoubleClick,
  onColumnDoubleClick,
}: BlockingMatrixViewProps) {
  const [expandedCategories, setExpandedCategories] = useState<CategoryState>({
    person: true,
    room: true,
    time: true,
  });

  const { columns, rows } = data;

  const categories = useMemo(() => {
    const grouped: Record<MatrixColumnType, MatrixColumn[]> = {
      person: [],
      room: [],
      time: [],
    };
    for (const col of columns) {
      grouped[col.type].push(col);
    }

    return (['person', 'room', 'time'] as MatrixColumnType[])
      .filter(type => grouped[type].length > 0)
      .map(type => ({
        type,
        columns: grouped[type],
        totalCardinality: grouped[type].reduce((sum, c) => sum + c.cardinality, 0),
      }));
  }, [columns]);

  const toggleCategory = useCallback((type: MatrixColumnType) => {
    setExpandedCategories(prev => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const handleColumnClick = useCallback((columnId: string, event: React.MouseEvent) => {
    const newSelected = new Set(selection.selectedColumns);
    if (event.shiftKey) {
      if (newSelected.has(columnId)) {
        newSelected.delete(columnId);
      } else {
        newSelected.add(columnId);
      }
    } else {
      if (newSelected.has(columnId) && newSelected.size === 1) {
        newSelected.clear();
      } else {
        newSelected.clear();
        newSelected.add(columnId);
      }
    }
    onSelectionChange({ ...selection, selectedColumns: newSelected });
  }, [selection, onSelectionChange]);

  const handleRowClick = useCallback((defenseId: number, event: React.MouseEvent) => {
    const newSelected = new Set(selection.selectedRows);
    if (event.shiftKey) {
      if (newSelected.has(defenseId)) {
        newSelected.delete(defenseId);
      } else {
        newSelected.add(defenseId);
      }
    } else {
      if (newSelected.has(defenseId) && newSelected.size === 1) {
        newSelected.clear();
      } else {
        newSelected.clear();
        newSelected.add(defenseId);
      }
    }
    onSelectionChange({ ...selection, selectedRows: newSelected });
  }, [selection, onSelectionChange]);

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        No blocking data to display
      </div>
    );
  }

  const maxCardinality = Math.max(...columns.map(c => c.cardinality), 1);

  return (
    <div className="flex flex-col h-full border border-slate-400 rounded-lg bg-white">
      {/* Header area with bars and diagonal labels */}
      <div className="flex shrink-0 bg-slate-50 border-b border-slate-400 overflow-visible pt-14">
        {/* Row label header */}
        <div
          className="shrink-0 flex items-end justify-start px-3 pb-1.5 border-r border-slate-400"
          style={{ width: LABEL_WIDTH, height: BAR_HEIGHT + HEADER_HEIGHT }}
        >
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Defense</span>
        </div>

        {/* Category headers with bars */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex" style={{ height: BAR_HEIGHT + HEADER_HEIGHT }}>
            {categories.map((cat, catIdx) => {
              const config = typeConfig[cat.type];
              const Icon = config.icon;
              const isExpanded = expandedCategories[cat.type];
              const isLast = catIdx === categories.length - 1;

              if (!isExpanded) {
                // Collapsed category
                return (
                  <div
                    key={cat.type}
                    className={`flex flex-col items-center justify-end cursor-pointer transition-colors hover:bg-opacity-80 ${config.bgColor} ${!isLast ? 'border-r border-slate-400' : ''}`}
                    style={{ width: CATEGORY_WIDTH, height: BAR_HEIGHT + HEADER_HEIGHT }}
                    onClick={() => toggleCategory(cat.type)}
                  >
                    <div className="flex flex-col items-center pb-1.5">
                      <span className="text-[10px] font-bold text-slate-700 mb-0.5">{cat.totalCardinality}</span>
                      <Icon size={14} className={config.color} />
                      <ChevronRight size={10} className="text-slate-400 mt-0.5" />
                    </div>
                  </div>
                );
              }

              // Expanded category
              return (
                <div key={cat.type} className="flex flex-col">
                  {/* Cardinality bars */}
                  <div className={`flex items-end ${config.bgColor} bg-opacity-30 ${!isLast ? 'border-r border-slate-400' : ''}`} style={{ height: BAR_HEIGHT, paddingRight: !isLast ? 20 : 0 }}>
                    {/* Category collapse button */}
                    <div
                      className={`flex items-end justify-center cursor-pointer hover:bg-opacity-50 ${config.bgColor}`}
                      style={{ width: 30, height: BAR_HEIGHT }}
                      onClick={() => toggleCategory(cat.type)}
                    >
                      <ChevronRight size={10} className="text-slate-400 mb-1.5 rotate-90" />
                    </div>
                    {cat.columns.map(col => {
                      const barHeight = (col.cardinality / maxCardinality) * (BAR_HEIGHT - 20);
                      const selected = selection.selectedColumns.has(col.id);
                      return (
                        <div
                          key={col.id}
                          className="flex flex-col items-center justify-end cursor-pointer group"
                          style={{ width: CELL_WIDTH, height: BAR_HEIGHT, paddingLeft: 15 }}
                          onClick={(e) => handleColumnClick(col.id, e)}
                        >
                          <span className={`text-[9px] font-semibold mb-0.5 ${selected ? 'text-blue-700' : 'text-slate-600'}`}>
                            {col.cardinality}
                          </span>
                          <div
                            className="rounded-t transition-all group-hover:opacity-100"
                            style={{
                              width: BAR_WIDTH,
                              height: Math.max(barHeight, 3),
                              backgroundColor: selected ? '#1d4ed8' : config.barColor,
                              opacity: selected ? 1 : 0.7,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Diagonal column headers */}
                  <div className={`relative flex ${!isLast ? 'border-r border-slate-400' : ''}`} style={{ height: HEADER_HEIGHT, paddingRight: !isLast ? 20 : 0 }}>
                    <div style={{ width: 30 }} /> {/* Spacer for collapse button */}
                    {cat.columns.map(col => {
                      const selected = selection.selectedColumns.has(col.id);
                      return (
                        <div
                          key={col.id}
                          className="relative"
                          style={{ width: CELL_WIDTH, height: HEADER_HEIGHT }}
                        >
                          <div
                            className={`absolute bottom-0 origin-bottom-left cursor-pointer transition-all
                              ${selected ? 'font-semibold' : 'hover:font-medium'}`}
                            style={{
                              left: 'calc(50% + 15px)',
                              transform: 'rotate(-60deg) translateX(-50%)',
                              whiteSpace: 'nowrap',
                            }}
                            onClick={(e) => handleColumnClick(col.id, e)}
                            onDoubleClick={() => onColumnDoubleClick?.(col.id, col.resource, col.type)}
                          >
                            <span className={`flex items-center gap-1 text-[11px]
                              ${selected ? 'text-blue-700' : config.color}`}>
                              <Icon size={10} />
                              <span>{abbreviateResource(col.resource, col.type)}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body area with row labels and dot matrix - single scroll container */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex">
          {/* Row labels (fixed width, scrolls vertically with dots) */}
          <div className="shrink-0 sticky left-0 z-10 bg-white border-r border-gray-500" style={{ width: LABEL_WIDTH }}>
            {rows.map((row, idx) => {
              const selected = selection.selectedRows.has(row.defenseId);
              return (
                <div
                  key={row.defenseId}
                  className={`flex items-center px-3 cursor-pointer transition-colors hover:bg-blue-50
                    ${idx !== rows.length - 1 ? 'border-b border-gray-400' : ''}
                    ${selected ? 'bg-blue-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={(e) => handleRowClick(row.defenseId, e)}
                  onDoubleClick={() => onRowDoubleClick?.(row.defenseId, row.student)}
                >
                  <span className={`text-sm font-medium truncate ${selected ? 'text-blue-700' : 'text-gray-900'}`}>
                    {row.student}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Dot matrix (scrolls horizontally, shares vertical scroll with labels) */}
          <div className="flex-1 overflow-x-auto">
            {rows.map((row, rowIdx) => {
              const rowSelected = selection.selectedRows.has(row.defenseId);
              return (
                <div
                  key={row.defenseId}
                  className={`flex ${rowIdx !== rows.length - 1 ? 'border-b border-gray-400' : ''} ${rowSelected ? 'bg-blue-50/50' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  {categories.map((cat, catIdx) => {
                    const config = typeConfig[cat.type];
                    const isExpanded = expandedCategories[cat.type];
                    const isLast = catIdx === categories.length - 1;

                    if (!isExpanded) {
                      // Collapsed: show single aggregated dot
                      const hasAnyBlocking = cat.columns.some(col => row.blockedBy.has(col.id));
                      return (
                        <div
                          key={cat.type}
                          className={`flex items-center justify-center ${config.bgColor} bg-opacity-20 ${!isLast ? 'border-r border-gray-400' : ''}`}
                          style={{ width: CATEGORY_WIDTH, height: ROW_HEIGHT }}
                        >
                          {hasAnyBlocking ? (
                            <div
                              className="rounded-full"
                              style={{ width: DOT_RADIUS * 2, height: DOT_RADIUS * 2, backgroundColor: config.dotColor }}
                            />
                          ) : (
                            <div
                              className="rounded-full border"
                              style={{ width: EMPTY_RADIUS * 2, height: EMPTY_RADIUS * 2, borderColor: '#6b7280' }}
                            />
                          )}
                        </div>
                      );
                    }

                    // Expanded: show individual dots
                    return (
                      <div key={cat.type} className={`flex ${!isLast ? 'border-r border-gray-400' : ''}`} style={{ paddingRight: !isLast ? 20 : 0 }}>
                        <div style={{ width: 30 }} /> {/* Spacer */}
                        {cat.columns.map(col => {
                          const blocked = row.blockedBy.has(col.id);
                          const colSelected = selection.selectedColumns.has(col.id);
                          const highlighted = rowSelected || colSelected;

                          return (
                            <div
                              key={col.id}
                              className="flex items-center justify-center"
                              style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
                            >
                              {blocked ? (
                                <div
                                  className="rounded-full cursor-pointer transition-transform hover:scale-110"
                                  style={{
                                    width: DOT_RADIUS * 2,
                                    height: DOT_RADIUS * 2,
                                    backgroundColor: highlighted ? '#1d4ed8' : config.dotColor,
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleColumnClick(col.id, e);
                                  }}
                                />
                              ) : (
                                <div
                                  className="rounded-full"
                                  style={{
                                    width: EMPTY_RADIUS * 2,
                                    height: EMPTY_RADIUS * 2,
                                    border: `1px solid ${highlighted ? '#60a5fa' : '#9ca3af'}`,
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

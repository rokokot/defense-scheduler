/**
 * Blocking Matrix View - Defense-by-resource matrix with collapsible categories
 * Rows = blocked defenses (students)
 * Columns = blocking resources grouped by type (persons, rooms, time)
 */

import { useState, useCallback, useMemo } from 'react';
import { User, Building2, Clock, ChevronRight } from 'lucide-react';
import { MatrixColumn, MatrixColumnType, BlockingMatrixViewProps } from './types';

const LABEL_WIDTH = 200;
const CELL_WIDTH = 42;
const ROW_HEIGHT = 38;
const DOT_RADIUS = 5;
const EMPTY_RADIUS = 3;
const BAR_HEIGHT = 80;
const BAR_WIDTH = 18;
const HEADER_HEIGHT = 56;
const CATEGORY_WIDTH = 44;

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
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
    dotColor: '#334155',
    barColor: '#475569',
    icon: User,
  },
  room: {
    label: 'Rooms',
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
    dotColor: '#64748b',
    barColor: '#64748b',
    icon: Building2,
  },
  time: {
    label: 'Time',
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
    dotColor: '#94a3b8',
    barColor: '#94a3b8',
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
    <div className="flex flex-col h-full border border-slate-200 rounded-md bg-white">
      {/* Header area with bars and diagonal labels */}
      <div className="flex shrink-0 bg-slate-50/50 border-b border-slate-200 overflow-visible pt-12">
        {/* Row label header */}
        <div
          className="shrink-0 flex items-end justify-start px-4 pb-2 border-r border-slate-200"
          style={{ width: LABEL_WIDTH, height: BAR_HEIGHT + HEADER_HEIGHT }}
        >
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Defense</span>
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
                return (
                  <div
                    key={cat.type}
                    className={`flex flex-col items-center justify-end cursor-pointer transition-colors hover:bg-slate-100 bg-slate-50/50 ${!isLast ? 'border-r border-slate-200' : ''}`}
                    style={{ width: CATEGORY_WIDTH, height: BAR_HEIGHT + HEADER_HEIGHT }}
                    onClick={() => toggleCategory(cat.type)}
                  >
                    <div className="flex flex-col items-center pb-2">
                      <span className="text-[10px] font-semibold text-slate-500 mb-0.5">{cat.totalCardinality}</span>
                      <Icon size={13} className="text-slate-400" />
                      <ChevronRight size={9} className="text-slate-300 mt-0.5" />
                    </div>
                  </div>
                );
              }

              return (
                <div key={cat.type} className="flex flex-col">
                  {/* Cardinality bars */}
                  <div className={`flex items-end ${!isLast ? 'border-r border-slate-200' : ''}`} style={{ height: BAR_HEIGHT, paddingRight: !isLast ? 16 : 0 }}>
                    <div
                      className="flex items-end justify-center cursor-pointer hover:bg-slate-100"
                      style={{ width: 28, height: BAR_HEIGHT }}
                      onClick={() => toggleCategory(cat.type)}
                    >
                      <ChevronRight size={9} className="text-slate-300 mb-2 rotate-90" />
                    </div>
                    {cat.columns.map(col => {
                      const barHeight = (col.cardinality / maxCardinality) * (BAR_HEIGHT - 20);
                      const selected = selection.selectedColumns.has(col.id);
                      return (
                        <div
                          key={col.id}
                          className="flex flex-col items-center justify-end cursor-pointer group"
                          style={{ width: CELL_WIDTH, height: BAR_HEIGHT, paddingLeft: 12 }}
                          onClick={(e) => handleColumnClick(col.id, e)}
                        >
                          <span className={`text-[9px] font-medium mb-1 ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
                            {col.cardinality}
                          </span>
                          <div
                            className="rounded-sm transition-all group-hover:opacity-100"
                            style={{
                              width: BAR_WIDTH,
                              height: Math.max(barHeight, 2),
                              backgroundColor: selected ? '#1e293b' : config.barColor,
                              opacity: selected ? 1 : 0.5,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Diagonal column headers */}
                  <div className={`relative flex ${!isLast ? 'border-r border-slate-200' : ''}`} style={{ height: HEADER_HEIGHT, paddingRight: !isLast ? 16 : 0 }}>
                    <div style={{ width: 28 }} />
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
                              left: 'calc(50% + 12px)',
                              transform: 'rotate(-55deg) translateX(-50%)',
                              whiteSpace: 'nowrap',
                            }}
                            onClick={(e) => handleColumnClick(col.id, e)}
                            onDoubleClick={() => onColumnDoubleClick?.(col.id, col.resource, col.type)}
                          >
                            <span className={`flex items-center gap-1 text-[10px]
                              ${selected ? 'text-slate-800' : 'text-slate-500'}`}>
                              <Icon size={9} className="opacity-60" />
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

      {/* Body area with row labels and dot matrix */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex">
          {/* Row labels */}
          <div className="shrink-0 sticky left-0 z-10 bg-white border-r border-slate-200" style={{ width: LABEL_WIDTH }}>
            {rows.map((row, idx) => {
              const selected = selection.selectedRows.has(row.defenseId);
              return (
                <div
                  key={row.defenseId}
                  className={`flex items-center px-4 cursor-pointer transition-colors hover:bg-slate-50
                    ${idx !== rows.length - 1 ? 'border-b border-slate-100' : ''}
                    ${selected ? 'bg-blue-50' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={(e) => handleRowClick(row.defenseId, e)}
                  onDoubleClick={() => onRowDoubleClick?.(row.defenseId, row.student)}
                >
                  <span className={`text-[12px] font-medium truncate ${selected ? 'text-blue-700' : 'text-slate-700'}`}>
                    {row.student}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Dot matrix */}
          <div className="flex-1 overflow-x-auto">
            {rows.map((row, rowIdx) => {
              const rowSelected = selection.selectedRows.has(row.defenseId);
              return (
                <div
                  key={row.defenseId}
                  className={`flex ${rowIdx !== rows.length - 1 ? 'border-b border-slate-100' : ''} ${rowSelected ? 'bg-slate-50' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  {categories.map((cat, catIdx) => {
                    const config = typeConfig[cat.type];
                    const isExpanded = expandedCategories[cat.type];
                    const isLast = catIdx === categories.length - 1;

                    if (!isExpanded) {
                      const hasAnyBlocking = cat.columns.some(col => row.blockedBy.has(col.id));
                      return (
                        <div
                          key={cat.type}
                          className={`flex items-center justify-center ${!isLast ? 'border-r border-slate-200' : ''}`}
                          style={{ width: CATEGORY_WIDTH, height: ROW_HEIGHT }}
                        >
                          {hasAnyBlocking ? (
                            <div
                              className="rounded-full"
                              style={{ width: DOT_RADIUS * 2, height: DOT_RADIUS * 2, backgroundColor: config.dotColor }}
                            />
                          ) : (
                            <div
                              className="rounded-full"
                              style={{ width: EMPTY_RADIUS * 2, height: EMPTY_RADIUS * 2, border: '1px solid #cbd5e1' }}
                            />
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={cat.type} className={`flex ${!isLast ? 'border-r border-slate-200' : ''}`} style={{ paddingRight: !isLast ? 16 : 0 }}>
                        <div style={{ width: 28 }} />
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
                                  className="rounded-full cursor-pointer transition-transform hover:scale-125"
                                  style={{
                                    width: DOT_RADIUS * 2,
                                    height: DOT_RADIUS * 2,
                                    backgroundColor: highlighted ? '#1e293b' : config.dotColor,
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
                                    border: `1px solid ${highlighted ? '#94a3b8' : '#e2e8f0'}`,
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

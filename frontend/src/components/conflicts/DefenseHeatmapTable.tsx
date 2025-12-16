/**
 * DefenseHeatmapTable - Defense-level constraint status with inline MUS expansion
 * Part of ConflictsPanelV2 three-tier progressive disclosure model
 */

import { useState, useMemo } from 'react';
import { DefenseHeatmapRow } from '../../data/mockConflictData';
import { MUSDrawer } from './MUSDrawer';

interface DefenseHeatmapTableProps {
  rows: DefenseHeatmapRow[];
  searchQuery: string;
  supervisorFilter: string | null;
  sortBy: 'severity' | 'supervisor' | 'day' | 'student';
}

const CONSTRAINT_COLUMNS = [
  { key: 'room', title: 'Room' },
  { key: 'supervisor', title: 'Supervisor' },
  { key: 'coSupervisor', title: 'Co-supervisor' },
  { key: 'assessors', title: 'Assessors' },
  { key: 'mentor', title: 'Mentor' },
  { key: 'day', title: 'Day' },
] as const;

type ConstraintKey = typeof CONSTRAINT_COLUMNS[number]['key'];

export function DefenseHeatmapTable({
  rows,
  searchQuery,
  supervisorFilter,
  sortBy,
}: DefenseHeatmapTableProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    const filtered = rows.filter(row => {
      if (searchQuery && !row.student.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (supervisorFilter && row.supervisor !== supervisorFilter) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'student':
          return a.student.localeCompare(b.student);
        case 'supervisor':
          return a.supervisor.localeCompare(b.supervisor);
        case 'day':
          return a.targetDay.localeCompare(b.targetDay);
        case 'severity':
        default: {
          const countBlocking = (row: DefenseHeatmapRow) =>
            Object.values(row.constraints).filter(v => v === 'blocking').length;
          return countBlocking(b) - countBlocking(a);
        }
      }
    });
  }, [rows, searchQuery, supervisorFilter, sortBy]);

  const handleRowClick = (defenseId: string) => {
    setExpandedRowId(prev => (prev === defenseId ? null : defenseId));
  };

  const getIndicatorStyle = (status: string) => {
    switch (status) {
      case 'blocking':
        return 'bg-red-500 border-red-600';
      case 'tight':
        return 'bg-amber-400 border-amber-500';
      case 'unconstrained':
        return 'bg-transparent border-gray-300';
      case 'n/a':
      default:
        return 'hidden';
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="w-48 px-4 py-3 text-left">
              <span className="text-[10px] uppercase tracking-wide font-medium text-gray-600">
                Defense
              </span>
            </th>
            {CONSTRAINT_COLUMNS.map(col => (
              <th key={col.key} className="w-20 px-2 py-3 text-center">
                <span className="text-[10px] uppercase tracking-wide font-medium text-gray-600">
                  {col.title}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const isExpanded = expandedRowId === row.defenseId;
            return (
              <>
                <tr
                  key={row.defenseId}
                  className={`border-b border-gray-200 cursor-pointer transition-colors ${
                    isExpanded
                      ? 'bg-blue-50'
                      : 'bg-white hover:bg-blue-50 hover:shadow-sm'
                  }`}
                  onClick={() => handleRowClick(row.defenseId)}
                >
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{row.student}</div>
                    <div className="text-xs text-gray-600">{row.supervisor}</div>
                    <div className="text-xs text-gray-500">
                      {row.targetDay} • {row.targetTime}
                    </div>
                  </td>
                  {CONSTRAINT_COLUMNS.map(col => {
                    const status = row.constraints[col.key as ConstraintKey];
                    return (
                      <td key={col.key} className="px-2 py-3">
                        <div className="flex justify-center">
                          <div
                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${getIndicatorStyle(
                              status
                            )}`}
                            title={`${col.title}: ${status}`}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                {isExpanded && row.musComputed && row.musData && (
                  <tr key={`${row.defenseId}-drawer`}>
                    <td colSpan={7} className="p-0">
                      <div className="relative animate-slide-down">
                        <MUSDrawer
                          data={row.musData}
                          onClose={() => setExpandedRowId(null)}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {isExpanded && !row.musComputed && (
                  <tr key={`${row.defenseId}-loading`}>
                    <td colSpan={7} className="p-0">
                      <div className="bg-gray-50 border-t-2 border-blue-500 p-8 text-center">
                        <div className="text-sm text-gray-600">
                          MUS computation not available for this defense. Click to load detailed explanation.
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {sortedRows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">
          No unscheduled defenses match the current filters.
        </div>
      )}
    </div>
  );
}

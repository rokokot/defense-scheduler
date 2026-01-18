import { Mail, CheckCircle2, Clock, Edit2 } from 'lucide-react';

export type RequestStatus = 'draft' | 'pending' | 'fulfilled';

export interface AvailabilityRequest {
  id: string;
  personName: string;
  personRole: 'supervisor' | 'assessor' | 'mentor';
  requestedSlots: Array<{ day: string; timeSlot: string }>;
  reason: string;
  status: RequestStatus;
  createdAt: Date;
  sentAt?: Date;
  fulfilledAt?: Date;
  defenseIds: string[];
}

export interface CompactRequestCardProps {
  request: AvailabilityRequest;
  onSendRequest?: (requestId: string) => void;
  onMarkFulfilled?: (requestId: string) => void;
  onEditRequest?: (requestId: string) => void;
  onDeleteRequest?: (requestId: string) => void;
}

const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    color: 'bg-gray-300',
    textColor: 'text-gray-700',
    icon: Edit2,
  },
  pending: {
    label: 'Pending',
    color: 'bg-blue-500',
    textColor: 'text-blue-600',
    icon: Clock,
  },
  fulfilled: {
    label: 'Fulfilled',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    icon: CheckCircle2,
  },
};

function formatSlots(slots: Array<{ day: string; timeSlot: string }>): string {
  const grouped = slots.reduce((acc, slot) => {
    if (!acc[slot.day]) acc[slot.day] = [];
    acc[slot.day].push(slot.timeSlot);
    return acc;
  }, {} as Record<string, string[]>);

  return Object.entries(grouped)
    .map(([day, times]) => `${day}: ${times.join(', ')}`)
    .join(' • ');
}

export function CompactRequestCard({
  request,
  onSendRequest,
  onMarkFulfilled,
  onEditRequest,
  onDeleteRequest,
}: CompactRequestCardProps) {
  const statusConfig = STATUS_CONFIG[request.status];
  const StatusIcon = statusConfig.icon;

  return (
    <div className="border border-gray-200 rounded bg-white hover:shadow-md transition-shadow">
      <div className="p-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {request.personName}
            </span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">
              {request.personRole}
            </span>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusConfig.color} text-white flex items-center gap-1 flex-shrink-0`}
          >
            <StatusIcon className="w-2.5 h-2.5" />
            {statusConfig.label}
          </span>
        </div>

        <div className="text-[10px] text-gray-600">
          <div className="font-medium mb-0.5">Requested slots:</div>
          <div className="text-gray-500">{formatSlots(request.requestedSlots)}</div>
        </div>

        {request.reason && (
          <div className="text-[10px] text-gray-600">
            <span className="font-medium">Reason:</span>{' '}
            <span className="text-gray-500">{request.reason}</span>
          </div>
        )}

        <div className="text-[10px] text-gray-400">
          {request.defenseIds.length} {request.defenseIds.length === 1 ? 'defense' : 'defenses'} affected
        </div>

        <div className="flex gap-1 pt-1">
          {request.status === 'draft' && onSendRequest && (
            <button
              onClick={() => onSendRequest(request.id)}
              className="flex-1 px-2 py-1 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-1"
            >
              <Mail className="w-2.5 h-2.5" />
              Send
            </button>
          )}
          {request.status === 'draft' && onEditRequest && (
            <button
              onClick={() => onEditRequest(request.id)}
              className="flex-1 px-2 py-1 text-[10px] border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
          )}
          {request.status === 'pending' && onMarkFulfilled && (
            <button
              onClick={() => onMarkFulfilled(request.id)}
              className="flex-1 px-2 py-1 text-[10px] bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              Mark Fulfilled
            </button>
          )}
          {request.status === 'draft' && onDeleteRequest && (
            <button
              onClick={() => onDeleteRequest(request.id)}
              className="px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

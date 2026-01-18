import { PersonAvailability, AvailabilityStatus } from '../../availability/types';
import { Lock } from 'lucide-react';
import { AVAILABILITY_STATUS_BG } from '../../../config/availabilityColors';

export interface AvailabilityGridCompactProps {
  availabilities: PersonAvailability[];
  days: string[];
  dayLabels?: string[];
  timeSlots: string[];
  highlightedPersons?: string[];
  highlightedSlot?: { day: string; timeSlot: string };
  scheduledBookings?: Map<string, Map<string, string[]>>;
  programmeColors?: Record<string, string>;
  events?: Array<{ id: string; programme: string }>;
  maxHeight?: number;
}

const AVAILABILITY_STATUS_CLASSES: Record<AvailabilityStatus, string> = {
  available: `${AVAILABILITY_STATUS_BG.available} border border-gray-300`,
  unavailable: AVAILABILITY_STATUS_BG.unavailable,
  booked: '',
  empty: 'bg-white border border-gray-300',
};

function getProgrammeColorForSlot(
  bookingInfo: string[] | null,
  events?: Array<{ id: string; programme: string }>,
  programmeColors?: Record<string, string>
): string | undefined {
  if (!bookingInfo || bookingInfo.length === 0 || !events || !programmeColors) {
    return undefined;
  }

  const defenseId = bookingInfo[0];
  const defense = events.find(e => e.id === defenseId);

  if (!defense) {
    return undefined;
  }

  return programmeColors[defense.programme] || '#5183ff';
}

export function AvailabilityGridCompact({
  availabilities,
  days,
  dayLabels,
  timeSlots,
  highlightedPersons = [],
  highlightedSlot,
  scheduledBookings,
  programmeColors,
  events,
  maxHeight = 300,
}: AvailabilityGridCompactProps) {
  const sortedAvailabilities = [...availabilities].sort((a, b) => {
    const aHighlighted = highlightedPersons.includes(a.name);
    const bHighlighted = highlightedPersons.includes(b.name);

    if (aHighlighted && !bHighlighted) return -1;
    if (!aHighlighted && bHighlighted) return 1;

    return a.name.localeCompare(b.name);
  });

  return (
    <div
      className="border border-gray-200 rounded bg-white overflow-auto"
      style={{ maxHeight: `${maxHeight}px` }}
    >
      <table className="w-full text-[10px] border-collapse">
        <thead className="sticky top-0 bg-gray-50 z-10">
          <tr>
            <th className="text-left p-1 border-b border-r border-gray-200 font-semibold text-gray-700 min-w-[80px]">
              Person
            </th>
            {days.map((day, dayIndex) => (
              <th
                key={day}
                className="text-center p-1 border-b border-gray-200 font-semibold text-gray-700"
                colSpan={timeSlots.length}
              >
                {dayLabels?.[dayIndex] || day}
              </th>
            ))}
          </tr>
          <tr>
            <th className="border-b border-r border-gray-200"></th>
            {days.map(day =>
              timeSlots.map(slot => (
                <th
                  key={`${day}-${slot}`}
                  className="text-center p-0.5 border-b border-gray-200 text-[9px] text-gray-500 font-normal"
                >
                  {slot}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {sortedAvailabilities.map((person, personIndex) => (
            <tr
              key={person.name}
              className={`${
                highlightedPersons.includes(person.name)
                  ? 'bg-blue-50'
                  : personIndex % 2 === 0
                  ? 'bg-white'
                  : 'bg-gray-50'
              } hover:bg-blue-50`}
            >
              <td className="p-1 border-r border-gray-200 text-gray-900 font-medium sticky left-0 bg-inherit">
                {person.name}
              </td>
              {days.map(day =>
                timeSlots.map(slot => {
                  const slotKey = `${day}_${slot}`;
                  const slotData = person.availability[slotKey];
                  const status = (typeof slotData === 'string' ? slotData : slotData?.status) || 'empty';
                  const locked = (typeof slotData === 'object' && slotData?.locked) || false;

                  const bookingInfo =
                    scheduledBookings?.get(person.name)?.get(slotKey) || null;

                  const displayStatus: AvailabilityStatus =
                    bookingInfo && bookingInfo.length > 0 ? 'booked' : (status as AvailabilityStatus);

                  const programmeColor =
                    displayStatus === 'booked'
                      ? getProgrammeColorForSlot(bookingInfo, events, programmeColors)
                      : undefined;

                  const isHighlightedSlot =
                    highlightedSlot?.day === day && highlightedSlot?.timeSlot === slot;

                  return (
                    <td
                      key={`${day}-${slot}`}
                      className={`p-0 border-gray-100 relative ${
                        isHighlightedSlot ? 'ring-2 ring-blue-500 ring-inset' : ''
                      }`}
                    >
                      <div
                        className={`w-full h-6 flex items-center justify-center ${AVAILABILITY_STATUS_CLASSES[displayStatus]}`}
                        style={{
                          ...(programmeColor && { backgroundColor: programmeColor }),
                        }}
                      >
                        {locked && (
                          <Lock
                            className={`w-2 h-2 ${
                              displayStatus === 'available' || displayStatus === 'empty'
                                ? 'text-gray-600'
                                : 'text-white'
                            }`}
                            strokeWidth={2.5}
                          />
                        )}
                      </div>
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

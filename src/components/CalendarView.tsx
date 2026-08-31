import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon, MapPin, Users, User, DollarSign, AlignLeft } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isSameDay, addDays, parseISO } from 'date-fns';
import { CalendarEvent, EventStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { cn, formatLocation } from '../utils';
import { LocationInput } from './LocationInput';

interface CalendarViewProps {
  events: CalendarEvent[];
  onAddEvent: (event: CalendarEvent) => void;
  onUpdateEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  currentUser?: any;
}

export const CalendarView = React.memo(function CalendarView({ events, onAddEvent, onUpdateEvent, onDeleteEvent, currentUser }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [calendarFilter, setCalendarFilter] = useState<'Shared' | 'Personal'>('Shared');

  const filteredEvents = React.useMemo(() => {
    return events.filter(e => {
      const type = e.calendarType || 'Shared';
      if (calendarFilter === 'Personal') {
        return type === 'Personal' && e.createdBy === currentUser?.email;
      }
      return type === 'Shared';
    });
  }, [events, calendarFilter, currentUser]);

  const [formData, setFormData] = useState<Partial<CalendarEvent>>({
    title: '',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'Considering',
    location: undefined,
    attendees: '',
    cost: '',
    notes: '',
    calendarType: 'Shared',
  });

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
  };

  const openAddModal = (day?: Date) => {
    setEditingEvent(null);
    setFormData({
      title: '',
      startDate: format(day || new Date(), 'yyyy-MM-dd'),
      endDate: format(day || new Date(), 'yyyy-MM-dd'),
      status: 'Considering',
      location: undefined,
      attendees: '',
      cost: '',
      notes: '',
      calendarType: calendarFilter,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setFormData({
      ...event,
      startDate: event.startDate ? format(parseISO(event.startDate.split('T')[0]), 'yyyy-MM-dd') : '',
      endDate: event.endDate ? format(parseISO(event.endDate.split('T')[0]), 'yyyy-MM-dd') : '',
      calendarType: event.calendarType || 'Shared',
    });
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.startDate || !formData.endDate) return;

    const eventToSave: CalendarEvent = {
      // Was formData.title, which made the title the Firestore document id:
      // two events with the same name overwrote each other, and a title
      // containing '/' produced an invalid path. Existing events keep
      // their current ids; only new ones get a generated one.
      id: editingEvent ? editingEvent.id : uuidv4(),
      title: formData.title,
      startDate: formData.startDate,
      endDate: formData.endDate,
      status: formData.status as EventStatus || 'Considering',
      location: formData.location || '',
      attendees: formData.attendees || '',
      cost: formData.cost || '',
      notes: formData.notes || '',
      calendarType: formData.calendarType || 'Shared',
      createdBy: editingEvent ? editingEvent.createdBy : currentUser?.email,
    };

    if (editingEvent) {
      onUpdateEvent(eventToSave);
    } else {
      onAddEvent(eventToSave);
    }
    setIsModalOpen(false);
  };

  const renderHeader = () => {
    return (
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 w-[220px]">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-colors duration-200">
            <button
              onClick={prevMonth}
              className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
            <button
              onClick={nextMonth}
              className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm">
            <button
              onClick={() => setCalendarFilter('Shared')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                calendarFilter === 'Shared' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <Users size={16} />
              <span className="hidden sm:inline">Shared</span>
            </button>
            <button
              onClick={() => setCalendarFilter('Personal')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                calendarFilter === 'Personal' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <User size={16} />
              <span className="hidden sm:inline">My Calendar</span>
            </button>
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm">
            <button
              onClick={() => setViewMode('calendar')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === 'calendar' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <CalendarIcon size={16} />
              <span className="hidden sm:inline">Calendar</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === 'list' 
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <AlignLeft size={16} />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>
          <button
            onClick={() => openAddModal()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 dark:hover:bg-indigo-600"
          >
            <Plus size={16} />
            Add Event
          </button>
        </div>
      </div>
    );
  };

  const renderDays = () => {
    const days = [];
    const startDate = startOfWeek(currentMonth);

    for (let i = 0; i < 7; i++) {
      days.push(
        <div key={i} className="text-center text-sm font-semibold text-slate-500 dark:text-slate-400 py-2">
          {format(addDays(startDate, i), 'EEE')}
        </div>
      );
    }

    return <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">{days}</div>;
  };

  // Optimize: Pre-parse event dates to avoid parsing inside the double loop
  const parsedEvents = React.useMemo(() => {
    return filteredEvents.map(e => {
      const start = e.startDate ? parseISO(e.startDate.split('T')[0]) : new Date();
      const end = e.endDate ? parseISO(e.endDate.split('T')[0]) : new Date();
      return {
        ...e,
        startDayTime: new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime(),
        endDayTime: new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime(),
      };
    });
  }, [filteredEvents]);

  const renderCells = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = '';

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, 'd');
        const cloneDay = day;
        const checkDayTime = new Date(cloneDay.getFullYear(), cloneDay.getMonth(), cloneDay.getDate()).getTime();

        // Find events for this day
        const dayEvents = parsedEvents.filter(e => checkDayTime >= e.startDayTime && checkDayTime <= e.endDayTime);

        days.push(
          <div
            key={day.toString()}
            onClick={() => handleDayClick(cloneDay)}
            className={cn(
              "min-h-[120px] border-b border-r border-slate-200 dark:border-slate-700 p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer",
              !isSameMonth(day, monthStart) ? "bg-slate-50/50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-600" : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200",
              isSameDay(day, selectedDate) ? "ring-2 ring-inset ring-indigo-500 dark:ring-indigo-400" : ""
            )}
          >
            <div className="flex justify-between items-start">
              <span className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium",
                isSameDay(day, new Date()) ? "bg-indigo-600 dark:bg-indigo-500 text-white" : ""
              )}>
                {formattedDate}
              </span>
              <button 
                onClick={(e) => { e.stopPropagation(); openAddModal(cloneDay); }}
                className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Plus size={14} />
              </button>
            </div>
            
            <div className="mt-2 flex flex-col gap-1">
              {dayEvents.map((event) => {
                const isConfirmed = event.status === 'Confirmed';
                const isNotGoing = event.status === 'Not Going';
                
                return (
                  <div
                    key={event.id}
                    onClick={(e) => openEditModal(event, e)}
                    className={cn(
                      "truncate rounded px-2 py-1 text-xs font-medium transition-colors",
                      isConfirmed 
                        ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50" 
                        : isNotGoing
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 line-through"
                          : "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 border border-dashed border-indigo-300 dark:border-indigo-700"
                    )}
                    title={`${event.title}${event.location ? ` - ${formatLocation(event.location)}` : ''}`}
                  >
                    <div className="truncate">{event.title}</div>
                    {event.location && (
                      <div className="truncate text-[10px] opacity-80 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} />
                        {formatLocation(event.location)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="grid grid-cols-7" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }
    return <div className="flex-1 border-l border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-bl-xl rounded-br-xl overflow-hidden transition-colors duration-200">{rows}</div>;
  };

  const renderListView = () => {
    const sortedEvents = [...filteredEvents].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    return (
      <div className="flex-1 overflow-auto bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 z-10">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Event Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Location</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Attendees</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cost</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {sortedEvents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                  No events found.
                </td>
              </tr>
            ) : (
              sortedEvents.map((event) => (
                <tr 
                  key={event.id} 
                  onClick={(e) => openEditModal(event, e)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-900 dark:text-slate-300">
                    {event.startDate ? format(parseISO(event.startDate.split('T')[0]), 'MMM d, yyyy') : 'No date'}
                    {event.startDate !== event.endDate && event.endDate && ` - ${format(parseISO(event.endDate.split('T')[0]), 'MMM d, yyyy')}`}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
                    {event.title}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={cn(
                      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                      event.status === 'Confirmed' ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" :
                      event.status === 'Not Going' ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" :
                      "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400"
                    )}>
                      {event.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                    {formatLocation(event.location) || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                    {event.attendees || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                    {event.cost || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                    {event.notes || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {renderHeader()}
      {viewMode === 'calendar' ? (
        <div className="flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm flex flex-col transition-colors duration-200">
          {renderDays()}
          {renderCells()}
        </div>
      ) : (
        renderListView()
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-2xl transition-colors duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                {editingEvent ? 'Edit Event' : 'Add Event'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-full p-2 text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Calendar Type</label>
                <select
                  value={formData.calendarType || 'Shared'}
                  onChange={(e) => setFormData({ ...formData, calendarType: e.target.value as 'Shared' | 'Personal' })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                >
                  <option value="Shared">Shared Calendar</option>
                  <option value="Personal">My Calendar</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Event Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  required
                  placeholder="e.g., TechCrunch Disrupt"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Start Date *</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">End Date *</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as EventStatus })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                >
                  <option value="Considering">Considering (Outline)</option>
                  <option value="Confirmed">Confirmed (Filled)</option>
                  <option value="Not Going">Not Going</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <MapPin size={16} className="text-slate-400 dark:text-slate-500" />
                  Location
                </label>
                <LocationInput
                  value={formData.location}
                  onChange={(val) => setFormData({ ...formData, location: val })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  placeholder="e.g., San Francisco, CA"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <Users size={16} className="text-slate-400 dark:text-slate-500" />
                  Attendees (Potentially Going)
                </label>
                <input
                  type="text"
                  value={formData.attendees}
                  onChange={(e) => setFormData({ ...formData, attendees: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  placeholder="e.g., John, Sarah"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <DollarSign size={16} className="text-slate-400 dark:text-slate-500" />
                  Cost
                </label>
                <input
                  type="text"
                  value={formData.cost}
                  onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  placeholder="e.g., $1,500/ticket"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <AlignLeft size={16} className="text-slate-400 dark:text-slate-500" />
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  placeholder="Event details, links, etc."
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                {editingEvent ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteEvent(editingEvent.id);
                      setIsModalOpen(false);
                    }}
                    className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                  >
                    Delete Event
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:hover:bg-indigo-600"
                  >
                    Save Event
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock3,
  ListTodo,
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { projectsApi, scheduleApi } from '@/api/client';
import { clsx } from 'clsx';

const milestoneStatusColor: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

const taskStatusColor: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_review: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ViewMode = 'month' | 'week' | 'gantt';
type TaskStatus = 'todo' | 'in_progress' | 'waiting_review' | 'done' | 'blocked';

type RoadmapTask = {
  id: string;
  milestoneId: string;
  workflowId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  dueDate?: string;
  dependencyTaskId?: string;
  blockingReason?: string;
  position?: number;
  createdAt?: string;
  updatedAt?: string;
};

type RoadmapMilestone = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  position?: number;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  tasks: RoadmapTask[];
};

type CalendarEvent = {
  id: string;
  type: 'milestone' | 'task';
  entityId: string;
  title: string;
  status: string;
  dateKey: string;
  milestoneTitle?: string;
  source: 'due_date' | 'created_at';
};

type GanttRow = {
  id: string;
  type: 'milestone' | 'task';
  label: string;
  status: string;
  start: Date;
  end: Date;
  taskId?: string;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const toDate = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);

const toDateKey = (date: Date) => {
  const day = startOfDay(date);
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
};

const parseDateKey = (dateKey: string): Date | null => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0);
};

const toInputDate = (value?: string | Date | null): string => {
  const date = toDate(value);
  if (!date) return '';
  const day = startOfDay(date);
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
};

const dateInputToIso = (value: string): string | undefined => {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return undefined;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
};

const formatDate = (value?: string | Date | null): string => {
  const date = toDate(value);
  return date ? startOfDay(date).toLocaleDateString() : '未设置';
};

const formatCompactDate = (value: Date): string =>
  startOfDay(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

const eventBadgeClass = (event: CalendarEvent): string => {
  if (event.type === 'milestone') {
    return 'bg-indigo-100 text-indigo-700';
  }
  if (event.status === 'blocked') {
    return 'bg-red-100 text-red-700';
  }
  if (event.status === 'done') {
    return 'bg-green-100 text-green-700';
  }
  return 'bg-sky-100 text-sky-700';
};

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const startOfWeekMonday = (date: Date) => {
  const day = startOfDay(date);
  const weekday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - weekday);
  return day;
};

const addDays = (date: Date, days: number) => {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
};

const diffDays = (start: Date, end: Date) =>
  Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / MS_PER_DAY);

export default function RoadmapPage() {
  const queryClient = useQueryClient();
  const today = startOfDay(new Date());

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState<Record<string, string>>({});
  const [newTaskDueDate, setNewTaskDueDate] = useState<Record<string, string>>({});

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentMonth, setCurrentMonth] = useState(monthStart(today));
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeekMonday(today));
  const [selectedDateKey, setSelectedDateKey] = useState(toDateKey(today));
  const [selectedTaskId, setSelectedTaskId] = useState('');

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const projects = projectsData?.data || [];

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const { data: schedule, isLoading } = useQuery({
    queryKey: ['project-schedule', selectedProjectId],
    queryFn: () => scheduleApi.getProjectSchedule(selectedProjectId),
    enabled: !!selectedProjectId,
    refetchInterval: 5000,
  });

  const milestones = useMemo(() => (schedule?.milestones || []) as RoadmapMilestone[], [schedule]);

  useEffect(() => {
    setSelectedTaskId('');
  }, [selectedProjectId]);

  const createMilestoneMutation = useMutation({
    mutationFn: (title: string) =>
      scheduleApi.createMilestone(selectedProjectId, {
        title,
        dueDate: dateInputToIso(newMilestoneDueDate),
        status: 'pending',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-schedule', selectedProjectId] });
      setNewMilestoneTitle('');
      setNewMilestoneDueDate('');
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: ({ milestoneId, title }: { milestoneId: string; title: string }) =>
      scheduleApi.createTask(milestoneId, {
        title,
        dueDate: dateInputToIso(newTaskDueDate[milestoneId] || ''),
        status: 'todo',
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project-schedule', selectedProjectId] });
      setNewTaskTitle((prev) => ({ ...prev, [variables.milestoneId]: '' }));
      setNewTaskDueDate((prev) => ({ ...prev, [variables.milestoneId]: '' }));
    },
  });

  const updateMilestoneMutation = useMutation({
    mutationFn: ({ milestoneId, dueDate }: { milestoneId: string; dueDate: string | null }) =>
      scheduleApi.updateMilestone(milestoneId, { dueDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-schedule', selectedProjectId] });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      patch,
    }: {
      taskId: string;
      patch: Partial<{ status: TaskStatus; dueDate: string | null }>;
    }) => scheduleApi.updateTask(taskId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-schedule', selectedProjectId] });
    },
  });

  const progress = schedule?.progress;

  const completionText = useMemo(() => {
    if (!progress) return '0%';
    return `${progress.completionRate}%`;
  }, [progress]);

  const taskLookup = useMemo(() => {
    const map = new Map<string, { task: RoadmapTask; milestone: RoadmapMilestone }>();
    for (const milestone of milestones) {
      for (const task of milestone.tasks || []) {
        map.set(task.id, { task, milestone });
      }
    }
    return map;
  }, [milestones]);

  useEffect(() => {
    if (selectedTaskId && !taskLookup.has(selectedTaskId)) {
      setSelectedTaskId('');
    }
  }, [selectedTaskId, taskLookup]);

  const selectedTaskDetail = selectedTaskId ? taskLookup.get(selectedTaskId) : undefined;

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];

    for (const milestone of milestones) {
      const milestoneDate = toDate(milestone.dueDate || milestone.createdAt);
      if (milestoneDate) {
        events.push({
          id: `milestone:${milestone.id}`,
          type: 'milestone',
          entityId: milestone.id,
          title: milestone.title,
          status: milestone.status,
          dateKey: toDateKey(milestoneDate),
          source: milestone.dueDate ? 'due_date' : 'created_at',
        });
      }

      for (const task of milestone.tasks || []) {
        const taskDate = toDate(task.dueDate || task.createdAt);
        if (!taskDate) continue;
        events.push({
          id: `task:${task.id}`,
          type: 'task',
          entityId: task.id,
          title: task.title,
          status: task.status,
          dateKey: toDateKey(taskDate),
          milestoneTitle: milestone.title,
          source: task.dueDate ? 'due_date' : 'created_at',
        });
      }
    }

    return events;
  }, [milestones]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of calendarEvents) {
      const list = map.get(event.dateKey) || [];
      list.push(event);
      map.set(event.dateKey, list);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'milestone' ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
      map.set(key, list);
    }
    return map;
  }, [calendarEvents]);

  const monthLabel = useMemo(
    () => currentMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }),
    [currentMonth]
  );

  const monthCells = useMemo(() => {
    const start = monthStart(currentMonth);
    const firstWeekday = (start.getDay() + 6) % 7;
    const gridStart = addDays(start, -firstWeekday);

    return Array.from({ length: 42 }, (_value, index) => {
      const date = addDays(gridStart, index);
      return {
        date,
        dateKey: toDateKey(date),
        inCurrentMonth: date.getMonth() === start.getMonth(),
      };
    });
  }, [currentMonth]);

  const selectedDateLabel = useMemo(() => {
    const date = parseDateKey(selectedDateKey);
    return date
      ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
      : selectedDateKey;
  }, [selectedDateKey]);

  const selectedDateEvents = eventsByDate.get(selectedDateKey) || [];
  const todayKey = toDateKey(today);

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_value, index) => {
        const date = addDays(currentWeekStart, index);
        return {
          date,
          dateKey: toDateKey(date),
          label: WEEK_DAYS[index],
        };
      }),
    [currentWeekStart]
  );

  const weekLabel = useMemo(() => {
    const end = addDays(currentWeekStart, 6);
    return `${formatCompactDate(currentWeekStart)} - ${formatCompactDate(end)}`;
  }, [currentWeekStart]);

  const ganttRows = useMemo<GanttRow[]>(() => {
    const rows: GanttRow[] = [];

    for (const milestone of milestones) {
      const milestoneStart = startOfDay(toDate(milestone.createdAt) || today);
      const milestoneEndCandidate = startOfDay(toDate(milestone.dueDate) || milestoneStart);
      const milestoneEnd = milestoneEndCandidate.getTime() < milestoneStart.getTime()
        ? milestoneStart
        : milestoneEndCandidate;

      rows.push({
        id: `milestone:${milestone.id}`,
        type: 'milestone',
        label: milestone.title,
        status: milestone.status,
        start: milestoneStart,
        end: milestoneEnd,
      });

      for (const task of milestone.tasks || []) {
        const taskStart = startOfDay(toDate(task.createdAt) || milestoneStart);
        const taskEndCandidate = startOfDay(toDate(task.dueDate) || taskStart);
        const taskEnd = taskEndCandidate.getTime() < taskStart.getTime() ? taskStart : taskEndCandidate;

        rows.push({
          id: `task:${task.id}`,
          type: 'task',
          label: `- ${task.title}`,
          status: task.status,
          start: taskStart,
          end: taskEnd,
          taskId: task.id,
        });
      }
    }

    return rows;
  }, [milestones, today]);

  const ganttBounds = useMemo(() => {
    if (ganttRows.length === 0) return null;

    let start = ganttRows[0].start;
    let end = ganttRows[0].end;

    for (const row of ganttRows) {
      if (row.start.getTime() < start.getTime()) start = row.start;
      if (row.end.getTime() > end.getTime()) end = row.end;
    }

    if (diffDays(start, end) < 6) {
      end = addDays(start, 6);
    }

    return {
      start,
      end,
      totalDays: diffDays(start, end) + 1,
    };
  }, [ganttRows]);

  const ganttTicks = useMemo(() => {
    if (!ganttBounds) return [];
    const ticks: Array<{ key: string; date: Date; offset: number }> = [];
    const step = Math.max(1, Math.ceil(ganttBounds.totalDays / 8));
    for (let day = 0; day < ganttBounds.totalDays; day += step) {
      const date = addDays(ganttBounds.start, day);
      ticks.push({
        key: toDateKey(date),
        date,
        offset: (day / ganttBounds.totalDays) * 100,
      });
    }
    const endOffset = ((ganttBounds.totalDays - 1) / ganttBounds.totalDays) * 100;
    ticks.push({
      key: `${toDateKey(ganttBounds.end)}:end`,
      date: ganttBounds.end,
      offset: endOffset,
    });
    return ticks;
  }, [ganttBounds]);

  const openTaskModal = (taskId: string) => {
    if (!taskLookup.has(taskId)) return;
    setSelectedTaskId(taskId);
  };

  const onEventItemClick = (event: CalendarEvent, withDateSelection?: boolean) => {
    if (withDateSelection) {
      setSelectedDateKey(event.dateKey);
    }
    if (event.type === 'task') {
      openTaskModal(event.entityId);
    }
  };

  const handlePrevRange = () => {
    if (viewMode === 'month') {
      setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
      return;
    }
    if (viewMode === 'week') {
      setCurrentWeekStart((prev) => addDays(prev, -7));
    }
  };

  const handleNextRange = () => {
    if (viewMode === 'month') {
      setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
      return;
    }
    if (viewMode === 'week') {
      setCurrentWeekStart((prev) => addDays(prev, 7));
    }
  };

  const handleJumpToCurrent = () => {
    if (viewMode === 'month') {
      setCurrentMonth(monthStart(today));
    } else if (viewMode === 'week') {
      setCurrentWeekStart(startOfWeekMonday(today));
    }
  };

  const rangeTitle = viewMode === 'month' ? monthLabel : viewMode === 'week' ? `第 ${weekLabel} 周` : '任务甘特图';

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目日程与进展</h1>
          <p className="text-gray-500 mt-1">可视化里程碑与任务进度，支持人工管理与工作流自动回写</p>
        </div>

        <div className="bg-white border rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">选择项目</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full max-w-md px-3 py-2 border rounded-lg"
          >
            <option value="">请选择</option>
            {projects.map((project: any) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        {selectedProjectId && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <ProgressCard icon={<ListTodo className="w-4 h-4 text-gray-600" />} label="任务总数" value={String(progress?.totalTasks || 0)} />
              <ProgressCard icon={<CheckCircle2 className="w-4 h-4 text-green-600" />} label="已完成" value={String(progress?.doneTasks || 0)} />
              <ProgressCard icon={<Clock3 className="w-4 h-4 text-blue-600" />} label="进行中" value={String(progress?.inProgressTasks || 0)} />
              <ProgressCard icon={<AlertTriangle className="w-4 h-4 text-red-600" />} label="阻塞" value={String(progress?.blockedTasks || 0)} />
              <ProgressCard icon={<CheckCircle2 className="w-4 h-4 text-purple-600" />} label="完成率" value={completionText} />
            </div>

            <div className="bg-white border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-900">里程碑</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  placeholder="新增里程碑标题"
                  className="flex-1 min-w-[220px] px-3 py-2 border rounded-lg"
                />
                <input
                  type="date"
                  value={newMilestoneDueDate}
                  onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg"
                />
                <button
                  onClick={() => newMilestoneTitle.trim() && createMilestoneMutation.mutate(newMilestoneTitle.trim())}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  添加里程碑
                </button>
              </div>
            </div>

            <div className="bg-white border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold text-gray-900">日历与排期视图</h2>
                  <p className="text-xs text-gray-500 mt-1">支持月视图、周视图与甘特视图。点击任务可直接打开详情弹窗。</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex border rounded-lg p-0.5 bg-gray-50">
                    <button
                      onClick={() => setViewMode('month')}
                      className={clsx(
                        'px-3 py-1.5 text-sm rounded-md',
                        viewMode === 'month' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'
                      )}
                    >
                      月视图
                    </button>
                    <button
                      onClick={() => setViewMode('week')}
                      className={clsx(
                        'px-3 py-1.5 text-sm rounded-md',
                        viewMode === 'week' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'
                      )}
                    >
                      周视图
                    </button>
                    <button
                      onClick={() => setViewMode('gantt')}
                      className={clsx(
                        'px-3 py-1.5 text-sm rounded-md',
                        viewMode === 'gantt' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'
                      )}
                    >
                      甘特图
                    </button>
                  </div>

                  {viewMode !== 'gantt' && (
                    <>
                      <button
                        onClick={handlePrevRange}
                        className="p-2 border rounded-lg hover:bg-gray-50"
                        aria-label="上一页"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleJumpToCurrent}
                        className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
                      >
                        当前
                      </button>
                      <button
                        onClick={handleNextRange}
                        className="p-2 border rounded-lg hover:bg-gray-50"
                        aria-label="下一页"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-700 mt-3">
                <CalendarDays className="w-4 h-4" />
                <span>{rangeTitle}</span>
              </div>

              {viewMode === 'month' && (
                <>
                  <div className="mt-3 grid grid-cols-7 gap-1 text-xs text-gray-500">
                    {WEEK_DAYS.map((day) => (
                      <div key={day} className="text-center py-1">{day}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((cell) => {
                      const dayEvents = eventsByDate.get(cell.dateKey) || [];
                      const isToday = cell.dateKey === todayKey;
                      const isSelected = cell.dateKey === selectedDateKey;
                      return (
                        <button
                          key={cell.dateKey}
                          onClick={() => setSelectedDateKey(cell.dateKey)}
                          className={clsx(
                            'h-24 border rounded-lg p-1 text-left align-top transition-colors',
                            cell.inCurrentMonth ? 'bg-white' : 'bg-gray-50',
                            isSelected ? 'border-primary-500 ring-1 ring-primary-200' : 'hover:bg-gray-50',
                            isToday && !isSelected ? 'border-blue-300' : 'border-gray-200'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className={clsx('text-xs', cell.inCurrentMonth ? 'text-gray-900' : 'text-gray-400')}>
                              {cell.date.getDate()}
                            </span>
                            {dayEvents.length > 0 && (
                              <span className="text-[10px] text-gray-500">{dayEvents.length}</span>
                            )}
                          </div>
                          <div className="mt-1 space-y-1">
                            {dayEvents.slice(0, 2).map((event) => (
                              <button
                                key={event.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEventItemClick(event, true);
                                }}
                                className={clsx(
                                  'w-full text-left text-[10px] leading-4 px-1 py-0.5 rounded truncate',
                                  eventBadgeClass(event),
                                  event.type === 'task' ? 'cursor-pointer hover:brightness-95' : ''
                                )}
                                title={event.title}
                              >
                                {event.type === 'milestone' ? 'M' : 'T'} {event.title}
                              </button>
                            ))}
                            {dayEvents.length > 2 && (
                              <div className="text-[10px] text-gray-500">+{dayEvents.length - 2} 更多</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {viewMode === 'week' && (
                <>
                  <div className="mt-3 text-sm text-gray-600">{weekLabel}</div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-7 gap-2">
                    {weekDays.map((day) => {
                      const dayEvents = eventsByDate.get(day.dateKey) || [];
                      const isToday = day.dateKey === todayKey;
                      const isSelected = day.dateKey === selectedDateKey;
                      return (
                        <div
                          key={day.dateKey}
                          className={clsx(
                            'border rounded-lg p-2 min-h-[180px]',
                            isSelected ? 'border-primary-500 ring-1 ring-primary-200' : 'border-gray-200'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedDateKey(day.dateKey)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-gray-900">
                                {day.label} {formatCompactDate(day.date)}
                              </div>
                              {isToday && <span className="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">今天</span>}
                            </div>
                          </button>
                          <div className="mt-2 space-y-1 max-h-[140px] overflow-auto">
                            {dayEvents.length === 0 ? (
                              <div className="text-xs text-gray-400">无事项</div>
                            ) : (
                              dayEvents.map((event) => (
                                <button
                                  key={event.id}
                                  type="button"
                                  onClick={() => onEventItemClick(event, true)}
                                  className={clsx(
                                    'w-full text-left text-xs px-2 py-1 rounded',
                                    eventBadgeClass(event),
                                    event.type === 'task' ? 'cursor-pointer hover:brightness-95' : ''
                                  )}
                                  title={event.title}
                                >
                                  {event.type === 'milestone' ? 'M' : 'T'} {event.title}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {viewMode === 'gantt' && (
                <div className="mt-3 border rounded-lg overflow-auto">
                  {ganttRows.length === 0 || !ganttBounds ? (
                    <div className="text-sm text-gray-500 p-4">暂无可绘制的排期数据</div>
                  ) : (
                    <div className="min-w-[980px]">
                      <div className="grid grid-cols-[280px_1fr] border-b bg-gray-50">
                        <div className="px-3 py-2 text-xs font-medium text-gray-600 border-r">事项</div>
                        <div className="relative h-10">
                          {ganttTicks.map((tick) => (
                            <div
                              key={tick.key}
                              className="absolute top-0 bottom-0 border-l border-gray-200"
                              style={{ left: `${tick.offset}%` }}
                            >
                              <div className="absolute top-1 left-1 text-[10px] text-gray-500 whitespace-nowrap">
                                {formatCompactDate(tick.date)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {ganttRows.map((row) => {
                        const leftPct = (diffDays(ganttBounds.start, row.start) / ganttBounds.totalDays) * 100;
                        const widthPct = ((diffDays(row.start, row.end) + 1) / ganttBounds.totalDays) * 100;
                        const isTaskRow = row.type === 'task' && !!row.taskId;
                        const barColor = row.type === 'milestone'
                          ? 'bg-indigo-500'
                          : row.status === 'blocked'
                            ? 'bg-red-500'
                            : row.status === 'done'
                              ? 'bg-green-500'
                              : 'bg-blue-500';

                        return (
                          <div key={row.id} className="grid grid-cols-[280px_1fr] border-b last:border-b-0">
                            <div className="px-3 py-2 text-sm text-gray-800 border-r truncate" title={row.label}>
                              {row.label}
                            </div>
                            <div className="px-2 py-2">
                              <div className="relative h-7 rounded bg-gray-50 border">
                                <button
                                  type="button"
                                  onClick={() => row.taskId && openTaskModal(row.taskId)}
                                  className={clsx(
                                    'absolute top-1 h-5 rounded text-white text-[10px] px-2 truncate',
                                    barColor,
                                    isTaskRow ? 'cursor-pointer hover:opacity-95' : 'cursor-default'
                                  )}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${Math.max(widthPct, 1.8)}%`,
                                  }}
                                  title={isTaskRow ? '点击查看任务详情' : row.label}
                                >
                                  {row.type === 'milestone' ? '里程碑' : '任务'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {viewMode !== 'gantt' && (
                <div className="mt-4 border-t pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900">{selectedDateLabel}</div>
                    <div className="text-xs text-gray-500">{selectedDateEvents.length} 项</div>
                  </div>
                  {selectedDateEvents.length === 0 ? (
                    <div className="text-sm text-gray-500 mt-2">当天无里程碑或任务记录</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedDateEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => onEventItemClick(event, true)}
                          className="w-full border rounded-lg p-2 flex items-center justify-between gap-2 text-left hover:bg-gray-50"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900 truncate">{event.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {event.type === 'milestone' ? '里程碑' : `任务 / ${event.milestoneTitle || '未分组'}`} · {event.source === 'due_date' ? '截止日期' : '创建日期'}
                              {event.type === 'task' ? ' · 点击查看详情' : ''}
                            </div>
                          </div>
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full', eventBadgeClass(event))}>
                            {event.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="text-gray-500 text-sm">加载中...</div>
            ) : (
              <div className="space-y-4">
                {milestones.map((milestone) => (
                  <div key={milestone.id} className="bg-white border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="font-medium text-gray-900">{milestone.title}</h3>
                        {milestone.description && (
                          <p className="text-sm text-gray-500 mt-1">{milestone.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">截止日期: {formatDate(milestone.dueDate)}</p>
                      </div>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full', milestoneStatusColor[milestone.status] || 'bg-gray-100 text-gray-700')}>
                        {milestone.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-500">设置里程碑截止日期</span>
                      <input
                        type="date"
                        value={toInputDate(milestone.dueDate)}
                        onChange={(e) =>
                          updateMilestoneMutation.mutate({
                            milestoneId: milestone.id,
                            dueDate: e.target.value ? (dateInputToIso(e.target.value) || null) : null,
                          })
                        }
                        className="text-xs px-2 py-1 border rounded"
                      />
                    </div>

                    <div className="mt-3 space-y-2">
                      {(milestone.tasks || []).length === 0 ? (
                        <div className="text-sm text-gray-500">暂无任务</div>
                      ) : (
                        milestone.tasks.map((task) => (
                          <div key={task.id} className="flex items-center gap-2 border rounded p-2" id={`task-${task.id}`}>
                            <button
                              type="button"
                              onClick={() => openTaskModal(task.id)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <div className="text-sm font-medium text-gray-900 truncate hover:underline">{task.title}</div>
                              {task.blockingReason && (
                                <div className="text-xs text-red-600 mt-0.5">阻塞原因: {task.blockingReason}</div>
                              )}
                              <div className="text-xs text-gray-500 mt-0.5">截止日期: {formatDate(task.dueDate)}</div>
                            </button>
                            <span className={clsx('text-xs px-2 py-0.5 rounded-full', taskStatusColor[task.status] || 'bg-gray-100 text-gray-700')}>
                              {task.status}
                            </span>
                            <input
                              type="date"
                              value={toInputDate(task.dueDate)}
                              onChange={(e) =>
                                updateTaskMutation.mutate({
                                  taskId: task.id,
                                  patch: { dueDate: e.target.value ? (dateInputToIso(e.target.value) || null) : null },
                                })
                              }
                              className="text-xs px-2 py-1 border rounded"
                            />
                            <select
                              value={task.status}
                              onChange={(e) =>
                                updateTaskMutation.mutate({
                                  taskId: task.id,
                                  patch: {
                                    status: e.target.value as TaskStatus,
                                  },
                                })
                              }
                              className="text-xs px-2 py-1 border rounded"
                            >
                              <option value="todo">todo</option>
                              <option value="in_progress">in_progress</option>
                              <option value="waiting_review">waiting_review</option>
                              <option value="done">done</option>
                              <option value="blocked">blocked</option>
                            </select>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        value={newTaskTitle[milestone.id] || ''}
                        onChange={(e) => setNewTaskTitle((prev) => ({ ...prev, [milestone.id]: e.target.value }))}
                        placeholder="新增任务标题"
                        className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm"
                      />
                      <input
                        type="date"
                        value={newTaskDueDate[milestone.id] || ''}
                        onChange={(e) => setNewTaskDueDate((prev) => ({ ...prev, [milestone.id]: e.target.value }))}
                        className="px-3 py-2 border rounded-lg text-sm"
                      />
                      <button
                        onClick={() => {
                          const title = (newTaskTitle[milestone.id] || '').trim();
                          if (!title) return;
                          createTaskMutation.mutate({ milestoneId: milestone.id, title });
                        }}
                        className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                      >
                        添加任务
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selectedTaskDetail && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center" onClick={() => setSelectedTaskId('')}>
          <div
            className="w-full max-w-2xl bg-white border rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">任务详情</h3>
                <p className="text-xs text-gray-500 mt-1">来自里程碑: {selectedTaskDetail.milestone.title}</p>
              </div>
              <button
                onClick={() => setSelectedTaskId('')}
                className="p-2 rounded-lg hover:bg-gray-100"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <div className="text-sm text-gray-500">任务标题</div>
                <div className="text-base font-medium text-gray-900 mt-1">{selectedTaskDetail.task.title}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DetailField label="任务 ID" value={selectedTaskDetail.task.id} />
                <DetailField label="Workflow ID" value={selectedTaskDetail.task.workflowId || '-'} />

                <div>
                  <label className="block text-xs text-gray-500 mb-1">状态</label>
                  <select
                    value={selectedTaskDetail.task.status}
                    onChange={(e) =>
                      updateTaskMutation.mutate({
                        taskId: selectedTaskDetail.task.id,
                        patch: { status: e.target.value as TaskStatus },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="todo">todo</option>
                    <option value="in_progress">in_progress</option>
                    <option value="waiting_review">waiting_review</option>
                    <option value="done">done</option>
                    <option value="blocked">blocked</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">截止日期</label>
                  <input
                    type="date"
                    value={toInputDate(selectedTaskDetail.task.dueDate)}
                    onChange={(e) =>
                      updateTaskMutation.mutate({
                        taskId: selectedTaskDetail.task.id,
                        patch: { dueDate: e.target.value ? (dateInputToIso(e.target.value) || null) : null },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>

                <DetailField label="创建时间" value={formatDate(selectedTaskDetail.task.createdAt)} />
                <DetailField label="更新时间" value={formatDate(selectedTaskDetail.task.updatedAt)} />
              </div>

              {selectedTaskDetail.task.description && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">描述</div>
                  <div className="text-sm text-gray-800 border rounded-lg p-3 bg-gray-50">
                    {selectedTaskDetail.task.description}
                  </div>
                </div>
              )}

              {selectedTaskDetail.task.blockingReason && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">阻塞原因</div>
                  <div className="text-sm text-red-700 border border-red-100 rounded-lg p-3 bg-red-50">
                    {selectedTaskDetail.task.blockingReason}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t flex justify-end">
              <button
                onClick={() => setSelectedTaskId('')}
                className="px-4 py-2 rounded-lg border hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProgressCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="flex items-center gap-2 text-gray-600 text-sm">{icon}{label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 mt-1 break-all">{value}</div>
    </div>
  );
}


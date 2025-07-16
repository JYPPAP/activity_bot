// src/interfaces/ICalendarLogService.ts - 달력 로그 서비스 인터페이스

/**
 * 달력 관련 데이터 인터페이스
 */
export interface CalendarEventData {
  date: string;
  eventType: 'activity' | 'gap' | 'role_change' | 'milestone';
  title: string;
  description?: string;
  participants?: string[];
  metadata?: Record<string, any>;
}

export interface CalendarSummary {
  period: { start: Date; end: Date };
  totalEvents: number;
  eventsByType: Record<string, number>;
  participantCount: number;
  highlights: string[];
}

export interface ActivityCalendarEntry {
  date: string;
  userId: string;
  nickname: string;
  activityTime: number;
  role: string;
  events: string[];
}

/**
 * 달력 로그 서비스 인터페이스
 * 사용자 활동 및 역할 변경을 달력 형태로 관리하는 서비스
 */
export interface ICalendarLogService {
  // 초기화 및 설정
  initialize(): Promise<void>;
  isInitialized(): boolean;

  // 일반 로그 이벤트
  logEvent(event: CalendarEventData): Promise<void>;
  logActivity(userId: string, activityTime: number, date?: Date): Promise<void>;
  logRoleChange(userId: string, oldRole: string, newRole: string, date?: Date): Promise<void>;
  logGapEvent(
    userId: string,
    gapType: string,
    details: Record<string, any>,
    date?: Date
  ): Promise<void>;

  // 주간 리포트 생성
  generateWeeklyReport(role: string, weekOffset?: number): Promise<string>;
  generateCustomReport(startDate: Date, endDate: Date, role?: string): Promise<string>;

  // 사용자 분류 로깅
  logUserClassificationResult(
    role: string,
    activeUsers: any[],
    inactiveUsers: any[],
    afkUsers: any[]
  ): Promise<void>;

  // 달력 데이터 조회
  getCalendarEvents(startDate: Date, endDate: Date): Promise<CalendarEventData[]>;
  getEventsForDate(date: Date): Promise<CalendarEventData[]>;
  getEventsForUser(userId: string, startDate?: Date, endDate?: Date): Promise<CalendarEventData[]>;

  // 통계 및 요약
  getCalendarSummary(startDate: Date, endDate: Date): Promise<CalendarSummary>;
  getUserActivityCalendar(
    userId: string,
    year: number,
    month: number
  ): Promise<ActivityCalendarEntry[]>;

  // 마일스톤 관리
  addMilestone(title: string, description: string, date?: Date): Promise<void>;
  getMilestones(startDate?: Date, endDate?: Date): Promise<CalendarEventData[]>;
  deleteMilestone(title: string, date: Date): Promise<void>;

  // 데이터 관리
  cleanupOldEvents(olderThanDays: number): Promise<number>;
  exportCalendarData(startDate: Date, endDate: Date): Promise<string>;
  importCalendarData(data: string): Promise<void>;

  // 알림 및 스케줄링
  scheduleWeeklyReport(role: string, enabled: boolean): void;
  getScheduledReports(): Array<{ role: string; enabled: boolean; lastRun?: Date }>;

  // 검색 및 필터링
  searchEvents(query: string, startDate?: Date, endDate?: Date): Promise<CalendarEventData[]>;
  filterEventsByType(
    eventType: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<CalendarEventData[]>;
  filterEventsByParticipant(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<CalendarEventData[]>;

  // 캐시 관리
  clearCache(): void;
  getCacheStats(): { size: number; hitRate: number };

  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;
}

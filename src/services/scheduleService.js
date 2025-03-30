// src/services/scheduleService.js - 스케줄링 서비스
import { formatKoreanDate } from '../utils/formatters.js';

/**
 * 정기적인 작업 스케줄링을 담당하는 서비스
 */
export class ScheduleService {
    constructor() {
        this.tasks = new Map();
    }

    /**
     * 매일 자정에 실행되는 작업 등록
     * @param {string} taskId - 작업 식별자
     * @param {Function} callback - 실행할 콜백 함수
     */
    scheduleDailyMidnight(taskId, callback) {
        // 기존 작업 취소
        if (this.tasks.has(taskId)) {
            clearTimeout(this.tasks.get(taskId));
        }

        const scheduleNext = () => {
            // 다음 자정까지의 시간 계산
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);

            const timeUntilMidnight = tomorrow.getTime() - now.getTime();

            // 타이머 설정
            this.tasks.set(taskId, setTimeout(() => {
                callback();
                scheduleNext(); // 다음 작업 예약
            }, timeUntilMidnight));

            console.log(`작업 ${taskId}가 ${formatKoreanDate(tomorrow)}에 예약되었습니다.`);
        };

        // 첫 작업 예약
        scheduleNext();
    }

    /**
     * 매주 특정 요일 자정에 실행되는 작업 등록
     * @param {string} taskId - 작업 식별자
     * @param {number} dayOfWeek - 요일 (0: 일요일, 1: 월요일, ...)
     * @param {Function} callback - 실행할 콜백 함수
     */
    scheduleWeekly(taskId, dayOfWeek, callback) {
        // 기존 작업 취소
        if (this.tasks.has(taskId)) {
            clearTimeout(this.tasks.get(taskId));
        }

        const scheduleNext = () => {
            // 다음 지정 요일까지의 시간 계산
            const now = new Date();
            const daysUntilTarget = (7 + dayOfWeek - now.getDay()) % 7;

            const nextDate = new Date(now);
            nextDate.setDate(now.getDate() + daysUntilTarget);
            nextDate.setHours(0, 0, 0, 0);

            // 같은 날이면 다음 주로 설정
            if (daysUntilTarget === 0 && now.getHours() >= 0) {
                nextDate.setDate(nextDate.getDate() + 7);
            }

            const timeUntilNext = nextDate.getTime() - now.getTime();

            // 타이머 설정
            this.tasks.set(taskId, setTimeout(() => {
                callback();
                scheduleNext(); // 다음 작업 예약
            }, timeUntilNext));

            console.log(`작업 ${taskId}가 ${formatKoreanDate(nextDate)}에 예약되었습니다.`);
        };

        // 첫 작업 예약
        scheduleNext();
    }

    /**
     * 등록된 작업 취소
     * @param {string} taskId - 작업 식별자
     */
    cancelTask(taskId) {
        if (this.tasks.has(taskId)) {
            clearTimeout(this.tasks.get(taskId));
            this.tasks.delete(taskId);
            console.log(`작업 ${taskId}가 취소되었습니다.`);
            return true;
        }
        return false;
    }

    /**
     * 모든 작업 취소
     */
    cancelAllTasks() {
        for (const [taskId, timeoutId] of this.tasks.entries()) {
            clearTimeout(timeoutId);
            console.log(`작업 ${taskId}가 취소되었습니다.`);
        }
        this.tasks.clear();
    }
}
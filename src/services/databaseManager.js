// src/services/databaseManager.js - SQLite 데이터베이스 관리
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

export class DatabaseManager {
    constructor() {
        this.db = null;
        this.dbPath = path.join(process.cwd(), 'activity_bot.db');
    }

    /**
     * 데이터베이스 연결 및 초기화
     */
    async initialize() {
        try {
            // SQLite 데이터베이스 연결
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            // 디버그 모드에서 SQL 쿼리 로깅
            if (process.env.DEBUG === 'true') {
                this.db.on('trace', (sql) => console.log(`SQL: ${sql}`));
            }

            console.log(`SQLite 데이터베이스가 ${this.dbPath}에 연결되었습니다.`);

            // 테이블 생성
            await this.createTables();
            return true;
        } catch (error) {
            console.error('데이터베이스 초기화 오류:', error);
            return false;
        }
    }

    /**
     * 필요한 데이터베이스 테이블 생성
     */
    async createTables() {
        // 트랜잭션 시작
        await this.db.exec('BEGIN TRANSACTION');

        try {
            // 사용자 활동 데이터 테이블
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_activity (
          userId TEXT PRIMARY KEY,
          totalTime INTEGER DEFAULT 0,
          startTime INTEGER DEFAULT NULL,
          displayName TEXT
        )
      `);

            // 역할 설정 테이블
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS role_config (
          roleName TEXT PRIMARY KEY,
          minHours INTEGER DEFAULT 0,
          resetTime INTEGER DEFAULT NULL
        )
      `);

            // 로그 테이블
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT,
          eventType TEXT,
          channelId TEXT,
          channelName TEXT,
          timestamp INTEGER,
          membersCount INTEGER DEFAULT 0
        )
      `);

            // 로그 멤버 관계 테이블
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS log_members (
          logId INTEGER,
          memberName TEXT,
          PRIMARY KEY (logId, memberName),
          FOREIGN KEY (logId) REFERENCES activity_logs(id) ON DELETE CASCADE
        )
      `);

            // 역할 리셋 기록 테이블
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS reset_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          roleName TEXT,
          resetTime INTEGER,
          reason TEXT
        )
      `);

            // 인덱스 생성
            await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON activity_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_userid ON activity_logs(userId);
        CREATE INDEX IF NOT EXISTS idx_logs_eventtype ON activity_logs(eventType);
      `);

            // 트랜잭션 커밋
            await this.db.exec('COMMIT');
            console.log('데이터베이스 테이블이 생성되었습니다.');
        } catch (error) {
            // 오류 발생 시 롤백
            await this.db.exec('ROLLBACK');
            console.error('테이블 생성 중 오류 발생:', error);
            throw error;
        }
    }

    /**
     * 데이터베이스 내 데이터 존재 확인
     */
    async hasAnyData() {
        const userCount = await this.db.get('SELECT COUNT(*) as count FROM user_activity');
        return userCount.count > 0;
    }

    /**
     * 데이터베이스 연결 종료
     */
    async close() {
        if (this.db) {
            await this.db.close();
            console.log('데이터베이스 연결이 종료되었습니다.');
        }
    }

    /**
     * 트랜잭션 시작
     */
    async beginTransaction() {
        await this.db.exec('BEGIN TRANSACTION');
    }

    /**
     * 트랜잭션 커밋
     */
    async commitTransaction() {
        await this.db.exec('COMMIT');
    }

    /**
     * 트랜잭션 롤백
     */
    async rollbackTransaction() {
        await this.db.exec('ROLLBACK');
    }

    // ======== 사용자 활동 관련 메서드 ========

    /**
     * 사용자 활동 데이터 가져오기
     */
    async getUserActivity(userId) {
        return await this.db.get('SELECT * FROM user_activity WHERE userId = ?', userId);
    }

    /**
     * 사용자 활동 데이터 업데이트/삽입
     */
    async updateUserActivity(userId, totalTime, startTime, displayName) {
        await this.db.run(
            `INSERT OR REPLACE INTO user_activity 
       (userId, totalTime, startTime, displayName) 
       VALUES (?, ?, ?, ?)`,
            userId, totalTime, startTime, displayName
        );
    }

    /**
     * 모든 사용자 활동 데이터 가져오기
     */
    async getAllUserActivity() {
        return await this.db.all('SELECT * FROM user_activity');
    }

    /**
     * 특정 역할을 가진 사용자들의 활동 데이터 가져오기
     */
    async getUserActivityByRole(roleId, guildId) {
        // 외부에서 Guild 객체를 통해 멤버를 가져와야 함
        // 이 메서드는 호출자가 역할별 사용자 필터링을 처리하도록 빈 껍데기로 남겨둠
        return await this.getAllUserActivity();
    }

    /**
     * 사용자 활동 데이터 삭제
     */
    async deleteUserActivity(userId) {
        await this.db.run('DELETE FROM user_activity WHERE userId = ?', userId);
    }

    // ======== 역할 설정 관련 메서드 ========

    /**
     * 역할 설정 가져오기
     */
    async getRoleConfig(roleName) {
        return await this.db.get('SELECT * FROM role_config WHERE roleName = ?', roleName);
    }

    /**
     * 역할 설정 업데이트/삽입
     */
    async updateRoleConfig(roleName, minHours, resetTime = null) {
        await this.db.run(
            `INSERT OR REPLACE INTO role_config 
       (roleName, minHours, resetTime) 
       VALUES (?, ?, ?)`,
            roleName, minHours, resetTime
        );
    }

    /**
     * 모든 역할 설정 가져오기
     */
    async getAllRoleConfigs() {
        return await this.db.all('SELECT * FROM role_config');
    }

    /**
     * 역할 리셋 시간 업데이트
     */
    async updateRoleResetTime(roleName, resetTime, reason = '관리자에 의한 리셋') {
        try {
            await this.beginTransaction();

            // 역할 설정 업데이트
            const roleConfig = await this.getRoleConfig(roleName);
            if (roleConfig) {
                await this.updateRoleConfig(roleName, roleConfig.minHours, resetTime);
            } else {
                await this.updateRoleConfig(roleName, 0, resetTime);
            }

            // 리셋 기록 추가
            await this.db.run(
                `INSERT INTO reset_history (roleName, resetTime, reason) VALUES (?, ?, ?)`,
                roleName, resetTime, reason
            );

            await this.commitTransaction();
        } catch (error) {
            await this.rollbackTransaction();
            throw error;
        }
    }

    /**
     * 역할 리셋 이력 가져오기
     */
    async getRoleResetHistory(roleName, limit = 5) {
        return await this.db.all(
            'SELECT * FROM reset_history WHERE roleName = ? ORDER BY resetTime DESC LIMIT ?',
            roleName, limit
        );
    }

    // ======== 활동 로그 관련 메서드 ========

    /**
     * 활동 로그 기록하기
     */
    async logActivity(userId, eventType, channelId, channelName, members = []) {
        try {
            await this.beginTransaction();

            // 타임스탬프 생성
            const timestamp = Date.now();

            // 로그 기록 생성
            const result = await this.db.run(
                `INSERT INTO activity_logs 
         (userId, eventType, channelId, channelName, timestamp, membersCount) 
         VALUES (?, ?, ?, ?, ?, ?)`,
                userId, eventType, channelId, channelName, timestamp, members.length
            );

            // 로그 ID 가져오기
            const logId = result.lastID;

            // 멤버 목록 저장
            for (const memberName of members) {
                await this.db.run(
                    'INSERT INTO log_members (logId, memberName) VALUES (?, ?)',
                    logId, memberName
                );
            }

            await this.commitTransaction();
            return logId;
        } catch (error) {
            await this.rollbackTransaction();
            console.error('활동 로깅 오류:', error);
            throw error;
        }
    }

    /**
     * 특정 기간의 활동 로그 가져오기
     */
    async getActivityLogs(startTime, endTime, eventType = null) {
        let query = `
      SELECT a.*, GROUP_CONCAT(m.memberName, ',') as members
      FROM activity_logs a
      LEFT JOIN log_members m ON a.id = m.logId
      WHERE a.timestamp BETWEEN ? AND ?
    `;

        const params = [startTime, endTime];

        if (eventType) {
            query += ' AND a.eventType = ?';
            params.push(eventType);
        }

        query += ' GROUP BY a.id ORDER BY a.timestamp DESC';

        const logs = await this.db.all(query, ...params);

        // members 문자열을 배열로 변환
        return logs.map(log => ({
            ...log,
            members: log.members ? log.members.split(',') : []
        }));
    }

    /**
     * 특정 사용자의 활동 로그 가져오기
     */
    async getUserActivityLogs(userId, limit = 100) {
        const query = `
      SELECT a.*, GROUP_CONCAT(m.memberName, ',') as members
      FROM activity_logs a
      LEFT JOIN log_members m ON a.id = m.logId
      WHERE a.userId = ?
      GROUP BY a.id
      ORDER BY a.timestamp DESC
      LIMIT ?
    `;

        const logs = await this.db.all(query, userId, limit);

        // members 문자열을 배열로 변환
        return logs.map(log => ({
            ...log,
            members: log.members ? log.members.split(',') : []
        }));
    }

    /**
     * 날짜별 활동 통계 가져오기
     */
    async getDailyActivityStats(startDate, endDate) {
        const query = `
      SELECT 
        date(timestamp/1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as totalEvents,
        SUM(CASE WHEN eventType = 'JOIN' THEN 1 ELSE 0 END) as joins,
        SUM(CASE WHEN eventType = 'LEAVE' THEN 1 ELSE 0 END) as leaves,
        COUNT(DISTINCT userId) as uniqueUsers
      FROM activity_logs
      WHERE timestamp BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date
    `;

        return await this.db.all(query, startDate, endDate);
    }

    // ======== 마이그레이션 메서드 ========

    /**
     * JSON 데이터에서 마이그레이션
     */
    async migrateFromJSON(activityData, roleConfigData) {
        try {
            await this.beginTransaction();

            // 사용자 활동 데이터 마이그레이션
            for (const [userId, data] of Object.entries(activityData)) {
                if (userId !== 'resetTimes') {
                    await this.updateUserActivity(
                        userId,
                        data.totalTime || 0,
                        data.startTime || null,
                        null // 기존 데이터에 displayName이 없을 수 있음
                    );
                }
            }

            // 역할 구성 마이그레이션
            for (const [roleName, minHours] of Object.entries(roleConfigData)) {
                const resetTime = activityData.resetTimes && activityData.resetTimes[roleName]
                    ? activityData.resetTimes[roleName]
                    : null;

                await this.updateRoleConfig(roleName, minHours, resetTime);

                // 리셋 이력에도 추가
                if (resetTime) {
                    await this.db.run(
                        `INSERT INTO reset_history (roleName, resetTime, reason) VALUES (?, ?, ?)`,
                        roleName, resetTime, 'JSON 데이터 마이그레이션'
                    );
                }
            }

            await this.commitTransaction();
            console.log('JSON 데이터가 성공적으로 마이그레이션되었습니다.');
            return true;
        } catch (error) {
            await this.rollbackTransaction();
            console.error('JSON 데이터 마이그레이션 오류:', error);
            throw error;
        }
    }
}
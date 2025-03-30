// migrate-to-lowdb.js
const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const ACTIVITY_FILE = path.join(__dirname, 'activity_info.json');
const ROLE_CONFIG_FILE = path.join(__dirname, 'role_activity_config.json');
const DB_FILE = path.join(__dirname, 'activity_bot.json');

console.log('LowDB로 데이터 마이그레이션을 시작합니다...');

try {
    // 기존 파일 존재 확인
    if (!fs.existsSync(ACTIVITY_FILE) || !fs.existsSync(ROLE_CONFIG_FILE)) {
        console.error('마이그레이션할 JSON 파일이 없습니다!');
        process.exit(1);
    }

    // 기존 JSON 파일 로드
    const activityData = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    const roleConfigData = JSON.parse(fs.readFileSync(ROLE_CONFIG_FILE, 'utf8'));

    // LowDB 설정
    const adapter = new FileSync(DB_FILE);
    const db = low(adapter);

    // 기본 구조 설정
    db.defaults({
        user_activity: {},
        role_config: {},
        activity_logs: [],
        reset_history: [],
        log_members: {}
    }).write();

    // 사용자 활동 데이터 마이그레이션
    console.log('사용자 활동 데이터 마이그레이션 중...');
    Object.entries(activityData).forEach(([userId, data]) => {
        if (userId !== 'resetTimes') {
            db.get('user_activity')
                .set(userId, {
                    userId,
                    totalTime: data.totalTime || 0,
                    startTime: data.startTime || null,
                    displayName: null
                })
                .write();
        }
    });

    // 역할 설정 마이그레이션
    console.log('역할 설정 마이그레이션 중...');
    Object.entries(roleConfigData).forEach(([roleName, minHours]) => {
        const resetTime = activityData.resetTimes && activityData.resetTimes[roleName]
            ? activityData.resetTimes[roleName]
            : null;

        db.get('role_config')
            .set(roleName, {
                roleName,
                minHours,
                resetTime
            })
            .write();

        // 리셋 기록 추가
        if (resetTime) {
            db.get('reset_history')
                .push({
                    id: Date.now() + '-' + roleName,
                    roleName,
                    resetTime,
                    reason: 'JSON 데이터 마이그레이션'
                })
                .write();
        }
    });

    // 백업 생성
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    fs.copyFileSync(ACTIVITY_FILE, `${ACTIVITY_FILE}.${timestamp}.bak`);
    fs.copyFileSync(ROLE_CONFIG_FILE, `${ROLE_CONFIG_FILE}.${timestamp}.bak`);

    console.log('마이그레이션이 성공적으로 완료되었습니다!');
    console.log(`원본 파일이 백업되었습니다: 
    ${ACTIVITY_FILE}.${timestamp}.bak
    ${ROLE_CONFIG_FILE}.${timestamp}.bak`);
    console.log(`새 데이터베이스 파일: ${DB_FILE}`);

} catch (error) {
    console.error('마이그레이션 오류:', error);
    process.exit(1);
}
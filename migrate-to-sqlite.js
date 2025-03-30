// migrate-to-sqlite.js - JSON 데이터를 SQLite로 마이그레이션하는 스크립트
import { DatabaseManager } from './src/services/databaseManager.js';
import { FileManager } from './src/services/fileManager.js';
import { PATHS } from './src/config/constants.js';
import fs from 'fs';
import path from 'path';

/**
 * JSON 데이터를 SQLite로 마이그레이션하는 함수
 */
async function migrateToSQLite() {
    console.log('JSON 데이터를 SQLite 데이터베이스로 마이그레이션합니다...');

    try {
        // 파일 존재 확인
        if (!fs.existsSync(PATHS.ACTIVITY_INFO) || !fs.existsSync(PATHS.ROLE_CONFIG)) {
            console.error('마이그레이션할 JSON 파일이 없습니다!');
            console.log(`확인된 경로: 
        - ${PATHS.ACTIVITY_INFO} (${fs.existsSync(PATHS.ACTIVITY_INFO) ? '존재' : '없음'})
        - ${PATHS.ROLE_CONFIG} (${fs.existsSync(PATHS.ROLE_CONFIG) ? '존재' : '없음'})
      `);
            return false;
        }

        // 인스턴스 생성
        const fileManager = new FileManager();
        const dbManager = new DatabaseManager();

        // 데이터베이스 초기화
        console.log('SQLite 데이터베이스 초기화 중...');
        await dbManager.initialize();

        // 이미 데이터가 있는지 확인
        const hasData = await dbManager.hasAnyData();
        if (hasData) {
            console.log('데이터베이스에 이미 데이터가 있습니다. 마이그레이션을 건너뜁니다.');
            console.log('강제로 마이그레이션하려면 데이터베이스 파일을 삭제하고 다시 시도하세요.');
            await dbManager.close();
            return false;
        }

        // JSON 파일 로드
        console.log('JSON 파일을 로드합니다...');
        const activityData = fileManager.loadJSON(PATHS.ACTIVITY_INFO);
        const roleConfigData = fileManager.loadJSON(PATHS.ROLE_CONFIG);

        // 데이터 유효성 검사
        if (Object.keys(activityData).length === 0) {
            console.error('activity_info.json 파일이 비어있거나 유효하지 않습니다!');
            await dbManager.close();
            return false;
        }

        if (Object.keys(roleConfigData).length === 0) {
            console.error('role_activity_config.json 파일이 비어있거나 유효하지 않습니다!');
            await dbManager.close();
            return false;
        }

        // 마이그레이션 실행
        console.log('데이터를 SQLite로 마이그레이션 중...');
        const success = await dbManager.migrateFromJSON(activityData, roleConfigData);

        if (success) {
            console.log('마이그레이션이 성공적으로 완료되었습니다!');

            // 백업 디렉토리 생성
            const backupDir = path.join(process.cwd(), 'backups');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir);
            }

            // 원본 JSON 파일 백업
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            fs.copyFileSync(PATHS.ACTIVITY_INFO, path.join(backupDir, `activity_info.${timestamp}.json`));
            fs.copyFileSync(PATHS.ROLE_CONFIG, path.join(backupDir, `role_activity_config.${timestamp}.json`));

            console.log(`원본 JSON 파일이 ${backupDir} 디렉토리에 백업되었습니다.`);
        } else {
            console.error('마이그레이션 과정에서 오류가 발생했습니다.');
        }

        // 데이터베이스 연결 종료
        await dbManager.close();
        return success;
    } catch (error) {
        console.error('마이그레이션 중 예기치 않은 오류 발생:', error);
        return false;
    }
}

// 스크립트 실행
migrateToSQLite()
    .then(success => {
        if (success) {
            console.log('마이그레이션이 완료되었습니다. 이제 봇을 SQLite 모드로 실행할 수 있습니다.');
        } else {
            console.log('마이그레이션이 실패했습니다. 위의 오류 메시지를 확인하세요.');
        }
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('마이그레이션 스크립트 실행 오류:', error);
        process.exit(1);
    });
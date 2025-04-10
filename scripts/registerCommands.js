// scripts/registerCommands.js - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes, ApplicationCommandOptionType } from 'discord-api-types/v9';
import dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

// 환경 변수 확인
const { TOKEN, CLIENT_ID, GUILDID } = process.env;

// 명령어 정의
const commands = [
    {
        name: 'gap_list',
        description: '역할별 활동 시간 목록을 표시합니다.',
        options: [
            {
                name: 'role',
                description: '조회할 역할 (콤마로 구분하여 여러 역할 지정 가능)',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'gap_config',
        description: '역할의 최소 활동 시간을 설정합니다.',
        options: [
            {
                name: 'role',
                description: '설정할 역할',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'hours',
                description: '최소 활동 시간 (시)',
                type: ApplicationCommandOptionType.Integer,
                required: true
            }
        ]
    },
    {
        name: 'gap_reset',
        description: '역할의 활동 시간을 초기화합니다.',
        options: [
            {
                name: 'role',
                description: '초기화할 역할',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'gap_check',
        description: '특정 사용자의 활동 시간을 확인합니다.',
        options: [
            {
                name: 'user',
                description: '확인할 사용자',
                type: ApplicationCommandOptionType.User,
                required: true
            }
        ]
    },
    {
        name: 'gap_save',
        description: '활동 데이터를 저장합니다.',
    },
    {
        name: 'gap_calendar',
        description: '날짜별 활동 로그를 확인합니다.',
        options: [
            {
                name: 'start_date',
                description: '시작일 (YYYY-MM-DD)',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'end_date',
                description: '종료일 (YYYY-MM-DD)',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: 'gap_stats',
        description: '상세 활동 통계를 확인합니다.',
        options: [
            {
                name: 'days',
                description: '조회 기간 (일)',
                type: ApplicationCommandOptionType.Integer,
                required: false
            },
            {
                name: 'user',
                description: '특정 사용자의 통계만 확인',
                type: ApplicationCommandOptionType.User,
                required: false
            }
        ]
    },
    // 새 명령어: gap_report
    {
        name: 'gap_report',
        description: '역할별 활동 보고서를 생성합니다.',
        options: [
            {
                name: 'role',
                description: '보고서를 생성할 역할',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'test_mode',
                description: '테스트 모드 (리셋 시간을 기록하지 않음)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            },
            {
                name: 'reset',
                description: '보고서 출력 후 활동 시간 초기화',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            },
            {
                name: 'log_channel',
                description: '보고서를 출력할 채널 (지정하지 않으면 기본 로그 채널)',
                type: ApplicationCommandOptionType.Channel,
                required: false
            }
        ]
    },
    // 새 명령어: gap_cycle
    {
        name: 'gap_cycle',
        description: '역할별 보고서 출력 주기를 설정합니다.',
        options: [
            {
                name: 'role',
                description: '주기를 설정할 역할',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'cycle',
                description: '출력 주기 (주 단위, 1: 매주, 2: 격주, 4: 월간)',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                choices: [
                    { name: '매주', value: 1 },
                    { name: '격주', value: 2 },
                    { name: '월간', value: 4 }
                ]
            }
        ]
    }
];

// REST 클라이언트 생성
const rest = new REST({ version: '9' }).setToken(TOKEN);

// 명령어 등록 함수
async function registerCommands() {
    try {
        console.log('슬래시 명령어 등록 중...');

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILDID),
            { body: commands }
        );

        console.log('슬래시 명령어가 성공적으로 등록되었습니다!');
    } catch (error) {
        console.error('슬래시 명령어 등록 중 오류 발생:', error);
    }
}

// 명령어 등록 실행
registerCommands();
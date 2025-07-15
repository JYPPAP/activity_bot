// scripts/registerCommands.js - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import { config } from '../src/config/env.js';

// 명령어 정의 배열 생성
const commands = [];

// 잠수 명령어 (기존 gap_afk)
commands.push(
  new SlashCommandBuilder()
    .setName('잠수')
    .setDescription('사용자를 잠수 상태로 설정합니다.')
    .addUserOption(option =>
      option.setName('user')
            .setDescription('잠수 상태로 설정할 사용자')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('until_date')
            .setDescription('잠수 해제 날짜 (YYMMDD 형식, 예: 250510)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
            .setDescription('잠수 설정 사유 (선택사항)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('notify_user')
            .setDescription('사용자에게 DM으로 알림 전송 여부')
            .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('duration_weeks')
            .setDescription('잠수 기간 (주 단위, 선택사항)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(52)
    )
);

// 설정 명령어 (기존 gap_config)
commands.push(
  new SlashCommandBuilder()
    .setName('설정')
    .setDescription('역할별 최소 활동시간을 설정합니다.')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('설정할 역할 이름')
            .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('hours')
            .setDescription('최소 활동시간 (시간)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(168)
    )
    .addStringOption(option =>
      option.setName('reset_time')
            .setDescription('리셋 시간 (선택사항, 형식: YYYY-MM-DD HH:MM)')
            .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('report_cycle')
            .setDescription('보고 주기 (선택사항)')
            .setRequired(false)
            .addChoices(
              { name: '일간', value: 'daily' },
              { name: '주간', value: 'weekly' },
              { name: '월간', value: 'monthly' }
            )
    )
    .addBooleanOption(option =>
      option.setName('enabled')
            .setDescription('역할 활성화 여부 (선택사항)')
            .setRequired(false)
    )
);

// 보고서 명령어 (기존 gap_report)
commands.push(
  new SlashCommandBuilder()
    .setName('보고서')
    .setDescription('역할별 활동 보고서를 생성합니다.')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('보고서를 생성할 역할 이름')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작 날짜 (YYMMDD 형식, 선택사항)')
            .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료 날짜 (YYMMDD 형식, 선택사항)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('test_mode')
            .setDescription('테스트 모드 (리셋 시간 기록 안함)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('reset')
            .setDescription('보고서 생성 후 활동 시간 리셋')
            .setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('log_channel')
            .setDescription('보고서를 전송할 채널')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('include_statistics')
            .setDescription('통계 정보 포함 여부')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('include_charts')
            .setDescription('차트 생성 여부')
            .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('export_format')
            .setDescription('내보내기 형식')
            .setRequired(false)
            .addChoices(
              { name: '임베드', value: 'embed' },
              { name: 'CSV', value: 'csv' },
              { name: 'JSON', value: 'json' }
            )
    )
);

// 시간체크 명령어 (그대로 유지)
commands.push(
  new SlashCommandBuilder()
    .setName('시간체크')
    .setDescription('특정 사용자의 활동 시간을 확인합니다.')
    .addUserOption(option =>
      option.setName('user')
            .setDescription('확인할 사용자')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작 날짜 (YYMMDD 형식, 예: 250413)')
            .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료 날짜 (YYMMDD 형식, 예: 250420)')
            .setRequired(false)
    )
);

// 구직 명령어 (그대로 유지)
commands.push(
  new SlashCommandBuilder()
    .setName('구직')
    .setDescription('구인구직 포럼 포스트를 생성합니다.')
);

// REST 클라이언트 생성
const rest = new REST({ version: '10' }).setToken(config.TOKEN);

(async () => {
    try {
        console.log('슬래시 명령어 등록을 시작합니다...');

        await rest.put(
          Routes.applicationGuildCommands(
            config.CLIENT_ID,
            config.GUILDID
          ),
          { body: commands.map(command => command.toJSON()) }
        );

        console.log('슬래시 명령어가 성공적으로 등록되었습니다!');
    } catch (error) {
        console.error('명령어 등록 중 오류 발생:', error);
    }
})();
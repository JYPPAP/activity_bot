// scripts/registerCommands.js - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import { config } from '../src/config/env.js';

// 명령어 정의 배열 생성
const commands = [];

// gap_list 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_list')
    .setDescription('역할별 활동 시간 목록을 표시합니다.(사용X)')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('조회할 역할 (콤마로 구분하여 여러 역할 지정 가능)')
            .setRequired(true)
    )
);

// gap_config 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_config')
    .setDescription('역할의 최소 활동 시간을 설정합니다.')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('설정할 역할')
            .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('hours')
            .setDescription('최소 활동 시간 (시)')
            .setRequired(true)
    )
);

// gap_reset 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_reset')
    .setDescription('역할의 활동 시간을 초기화합니다.(사용X)')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('초기화할 역할')
            .setRequired(true)
    )
);

// gap_check 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_check')
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

// gap_save 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_save')
    .setDescription('활동 데이터를 저장합니다.')
);

// gap_calendar 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_calendar')
    .setDescription('날짜별 활동 로그를 확인합니다.')
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작일 (YYYY-MM-DD)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료일 (YYYY-MM-DD)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('role')
            .setDescription('특정 역할만 조회 (콤마로 구분하여 여러 역할 지정 가능)')
            .setRequired(false)
    )
);

// gap_stats 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_stats')
    .setDescription('상세 활동 통계를 확인합니다.')
    .addIntegerOption(option =>
      option.setName('days')
            .setDescription('조회 기간 (일)')
            .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('user')
            .setDescription('특정 사용자의 통계만 확인')
            .setRequired(false)
    )
);

// gap_report 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_report')
    .setDescription('역할별 활동 보고서를 생성합니다.')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('보고서를 생성할 역할')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작 날짜 (YYMMDD 형식, 예: 250413)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료 날짜 (YYMMDD 형식, 예: 250420)')
            .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('test_mode')
            .setDescription('테스트 모드 여부 (기본: 테스트)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('reset')
            .setDescription('보고서 출력 후 활동 시간 초기화')
            .setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('log_channel')
            .setDescription('보고서를 출력할 채널 (지정하지 않으면 날짜-확인 채널)')
            .setRequired(false)
    )
);

// gap_cycle 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_cycle')
    .setDescription('역할별 보고서 출력 주기를 설정합니다.')
    .addStringOption(option =>
      option.setName('role')
            .setDescription('주기를 설정할 역할')
            .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('cycle')
            .setDescription('출력 주기 (주 단위, 1: 매주, 2: 격주, 4: 월간)')
            .setRequired(true)
            .addChoices(
              { name: '매주', value: 1 },
              { name: '격주', value: 2 },
              { name: '월간', value: 4 }
            )
    )
);

// gap_afk 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('gap_afk')
    .setDescription('사용자를 지정된 날짜까지 잠수 상태로 설정합니다.')
    .addUserOption(option =>
      option.setName('user')
            .setDescription('잠수 상태로 설정할 사용자')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('until_date')
            .setDescription('잠수 상태 유지 기한 (YYMMDD 형식, 예: 250510)')
            .setRequired(true)
    )
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
// scripts/registerCommands.js - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import { config } from '../src/config/env.js';

// 명령어 정의 배열 생성
const commands = [];

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

// 시간확인 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('시간확인')
    .setDescription('이번 달 활동 시간을 확인합니다.')
);

// 시간체크 명령어
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

// 보고서 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('보고서')
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

// 구직 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('구직')
    .setDescription('구인구직 포럼 포스트를 생성합니다.')
);

// 닉네임설정 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('닉네임설정')
    .setDescription('대상 채널에 닉네임 변경 버튼을 설정합니다.')
    .addStringOption(option =>
      option.setName('channel')
            .setDescription('대상 채널 ID')
            .setRequired(true)
    )
);

// REST 클라이언트 생성
const rest = new REST({ version: '10' }).setToken(config.TOKEN);

(async () => {
    try {
        console.log('기존 슬래시 명령어 정리 및 재등록을 시작합니다...');

        // 1단계: 기존 모든 길드 명령어 삭제 (정리)
        console.log('1단계: 기존 명령어 삭제 중...');
        await rest.put(
          Routes.applicationGuildCommands(
            config.CLIENT_ID,
            config.GUILDID
          ),
          { body: [] }
        );
        console.log('✅ 기존 명령어 삭제 완료');

        // 잠시 대기 (Discord API 안정성)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2단계: 필요한 명령어만 새로 등록
        console.log('2단계: 새 명령어 등록 중...');
        await rest.put(
          Routes.applicationGuildCommands(
            config.CLIENT_ID,
            config.GUILDID
          ),
          { body: commands.map(command => command.toJSON()) }
        );

        console.log(`✅ 슬래시 명령어가 성공적으로 등록되었습니다! (총 ${commands.length}개)`);
        console.log('📋 등록된 명령어 목록:');
        commands.forEach(cmd => {
            console.log(`  - /${cmd.name}: ${cmd.description}`);
        });
    } catch (error) {
        console.error('❌ 명령어 등록 중 오류 발생:', error);
    }
})();
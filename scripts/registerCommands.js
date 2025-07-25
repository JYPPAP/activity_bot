// scripts/registerCommands.js - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import { config } from '../src/config/env.js';

// 명령어 정의 배열 생성
const commands = [];

// 시간체크 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('시간체크')
    .setDescription('자신의 활동 시간을 확인합니다.')
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

// 보고서 명령어 (기존 gap_report)
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
    .addChannelOption(option =>
      option.setName('log_channel')
            .setDescription('보고서를 출력할 채널 (지정하지 않으면 날짜-확인 채널)')
            .setRequired(false)
    )
);

// 잠수 명령어 (기존 gap_afk)
commands.push(
  new SlashCommandBuilder()
    .setName('잠수')
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
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, PermissionsBitField, MessageFlags, EmbedBuilder, ChannelType } = require("discord.js");

// const { parse } = require('json2csv'); // json을 csv로 변환하는 라이브러리 필요
require('dotenv').config();
const keepAlive = require("./server_old");

const activityFilePath = path.join(__dirname, 'activity_info.json');
const configFilePath = path.join(__dirname, 'role_activity_config.json');
const excludedChannelIds = [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
    process.env.EXCLUDE_CHANNELID_4,
    process.env.EXCLUDE_CHANNELID_5
];

const logChannelId = process.env.LOG_CHANNEL_ID; // 로그를 출력할 채널 ID
let logMessages = [];
let logTimeout = null;

function logActivity(message, membersInChannel = []) {
    logMessages.push({ message, members: membersInChannel });

    if (logTimeout) {
        clearTimeout(logTimeout);
    }

    logTimeout = setTimeout(async () => {
        const logChannel = client.channels.cache.get(logChannelId);
        if (!logChannel) return;

        for (const log of logMessages) {
            const embed = new EmbedBuilder()
                .setColor('#0099ff') // 파란색
                // .setTitle('🔊 음성 채널 활동 로그')
                .setDescription(`**${log.message}**`)
                .setFooter({ text: `로그 기록 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` });

            // 현재 음성 채널의 인원 목록을 인원 수 포함 + 한 줄씩 출력
            const membersText = `**현재 인원: (${log.members ? log.members.length : 0}명)**\n${log.members && log.members.length > 0 ? log.members.join(',\n') : '없음'}`;

            embed.addFields({ name: '👥 현재 남아있는 멤버', value: membersText });

            await logChannel.send({ embeds: [embed] });
        }

        logMessages = []; // 로그 초기화
    }, 300000); // 테스트 30초, 5분 (300,000ms)
}


async function getVoiceChannelMembers(channel) {
    if (!channel) return [];
    const freshChannel = await channel.guild.channels.fetch(channel.id);
    return freshChannel.members.map(member => member.displayName);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let roleActivityConfig = {};
let channelActivityTime = new Map();
let saveActivityTimeout = null;


function loadJSON(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            console.error("Error parsing JSON data:", error);
        }
    }
    return {};
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error saving JSON data:", error);
    }
}

function loadMapFromJSON(filePath) {
    const jsonData = loadJSON(filePath);
    return new Map(Object.entries(jsonData));
}

function saveMapToJSON(filePath, mapData) {
    const jsonData = Object.fromEntries(mapData);
    saveJSON(filePath, jsonData);
}

function loadActivityData() {
    channelActivityTime = loadMapFromJSON(activityFilePath);
}

function loadRoleActivityConfig() {
    roleActivityConfig = loadJSON(configFilePath);
}

async function saveActivityData() {
    const now = Date.now();

    // Load existing activity data from JSON
    const existingActivityData = loadMapFromJSON(activityFilePath);

    // Update totalTime for each user based on their startTime
    for (const [userId, userActivity] of channelActivityTime) {
        if (userActivity.startTime) {
            const existingTotalTime = existingActivityData.get(userId)?.totalTime || 0;
            userActivity.totalTime = existingTotalTime + (now - userActivity.startTime);
            userActivity.startTime = now; // Reset startTime to now
        }
    }

    // Save the updated activity data including startTime
    saveMapToJSON(activityFilePath, channelActivityTime);
}

function debounceSaveActivityData() {
    // 기존 예약된 saveActivityData 실행을 취소
    if (saveActivityTimeout) {
        clearTimeout(saveActivityTimeout);
    }

    // 10분(600,000ms) 후 실행 예약
    saveActivityTimeout = setTimeout(async () => {
        await saveActivityData();
    }, 600000); // 10분
}

async function clearAndReinitializeActivityData(role) {
    await saveActivityData(); // Ensure data is saved before clearing

    const now = Date.now();
    const guild = client.guilds.cache.get(process.env.GUILDID);

    channelActivityTime = new Map();
    guild.members.fetch().then(members => {
        members.forEach(member => {
            const voiceState = member.voice;
            if (voiceState && voiceState.channelId && !excludedChannelIds.includes(voiceState.channelId)) {
                channelActivityTime.set(member.id, { startTime: now, totalTime: 0 });
            }
        });
    }).catch(error => {
        console.error("Error fetching guild members:", error);
    });

    // Save reset time for the role
    const activityData = loadMapFromJSON(activityFilePath);
    if (!activityData.has('resetTimes')) {
        activityData.set('resetTimes', {});
    }
    activityData.get('resetTimes')[role] = now;
    saveMapToJSON(activityFilePath, activityData);
}

async function initializeActivityData(guild) {
    // 역할 활동 설정 불러오기
    if (!fs.existsSync(configFilePath)) {
        console.error("❌ role_activity_config.json 파일이 없습니다.");
        return;
    }
    const roleActivityConfig = loadJSON(configFilePath);

    // 기존 저장된 사용자 데이터 불러오기
    let activityData = loadMapFromJSON(activityFilePath);

    // 길드(서버)의 모든 멤버 불러오기
    const members = await guild.members.fetch();

    members.forEach(member => {
        const userId = member.user.id;
        const userRoles = member.roles.cache.map(role => role.name); // 사용자의 역할 이름 가져오기

        // 사용자의 역할 중 role_activity_config에 있는 역할이 있는지 확인
        const hasTrackedRole = userRoles.some(role => roleActivityConfig.hasOwnProperty(role));

        if (hasTrackedRole) {
            if (!activityData.has(userId)) {
                // 사용자가 activity_info.json에 없으면 추가
                activityData.set(userId, {
                    startTime: 0,
                    totalTime: 0
                });
                // console.log(`✅ ${member.displayName} (${userId}) 추가됨 (초기화 상태)`);
            }
        }
    });

    // 변경된 데이터 저장
    saveMapToJSON(activityFilePath, activityData);
    console.log("✔ 활동 정보가 초기화되었습니다.");
}

function formatTime(totalTime) {
    const hours = Math.floor(totalTime / 1000 / 60 / 60);
    const minutes = Math.floor((totalTime / 1000 / 60) % 60);
    return `${hours}시간 ${minutes}분`;
}

async function sendActivityEmbed(interaction, activeUsers, inactiveUsers, role) {
    // Load reset time for the role
    const activityData = loadMapFromJSON(activityFilePath);
    const resetTimes = activityData.get('resetTimes') || {};
    const resetTime = resetTimes[role];
    const resetTimeFormatted = resetTime ? new Date(resetTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A';

    // Load minimum activity time for the role
    const roleActivityConfig = loadJSON(configFilePath);
    const minActivityTime = roleActivityConfig[role] ? roleActivityConfig[role] : 0;

    // Create embed for active users
    const activeEmbed = new EmbedBuilder()
        .setColor('#00FF00') // Green color
        .setTitle(`📊 활동 데이터 (역할: ${role})`)
        .setDescription(`마지막 리셋 시간: ${resetTimeFormatted}\n지정된 최소 활동 시간: ${minActivityTime}시간`)
        .addFields(
            { name: '상태', value: '달성', inline: true },
            { name: '이름', value: activeUsers.map(user => user.nickname).join('\n') || '없음', inline: true },
            { name: '총 활동 시간', value: activeUsers.map(user => formatTime(user.totalTime)).join('\n') || '없음', inline: true }
        );

    // Create embed for inactive users
    const inactiveEmbed = new EmbedBuilder()
        .setColor('#FF0000') // Red color
        .setTitle(`📊 활동 데이터 (역할: ${role})`)
        .setDescription(`마지막 리셋 시간: ${resetTimeFormatted}\n지정된 최소 활동 시간: ${minActivityTime}시간`)
        .addFields(
            { name: '상태', value: '부족', inline: true },
            { name: '이름', value: inactiveUsers.map(user => user.nickname).join('\n') || '없음', inline: true },
            { name: '총 활동 시간', value: inactiveUsers.map(user => formatTime(user.totalTime)).join('\n') || '없음', inline: true }
        );

    try {
        // DM으로 임베드 전송
        await interaction.user.send({ embeds: [activeEmbed] });
        await interaction.user.send({ embeds: [inactiveEmbed] });

        // 명령어 실행한 채널에도 알림 (DM 보냈다고)
        await interaction.followUp({
            content: '📩 활동 데이터 임베드를 DM으로 전송했습니다!',
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        console.error('DM 전송 실패:', error);

        // DM 전송 실패 시 채널에서 직접 임베드 제공
        await interaction.followUp({
            content: '📂 DM 전송에 실패했습니다. 여기에서 확인하세요:',
            embeds: [activeEmbed, inactiveEmbed],
            flags: MessageFlags.Ephemeral,
        });
    }
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadActivityData();
    loadRoleActivityConfig();

    const guild = client.guilds.cache.get(process.env.GUILDID);

    if (guild) {
        await initializeActivityData(guild);
    }

    const now = new Date();
    const formattedDate = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`봇이 켜졌습니다: ${formattedDate}`);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const userId = newState.id;
    const now = Date.now();
    const member = newState.member;

    // Log activity regardless of [관전] or [대기] status
    if (newState.channelId && !excludedChannelIds.includes(newState.channelId)) {
        const membersInChannel = await getVoiceChannelMembers(newState.channel);
        logActivity(`🔵 ${member.displayName}님이 음성채널 ${newState.channel.name}에 입장했습니다.`, membersInChannel);
    } else if (oldState.channelId && !excludedChannelIds.includes(oldState.channelId)) {
        const membersInChannel = await getVoiceChannelMembers(oldState.channel);
        logActivity(`🔴 ${member.displayName}님이 음성채널 ${oldState.channel.name}에서 퇴장했습니다.`, membersInChannel);
    }

    // Skip time tracking for [관전] or [대기]
    if (member && (member.displayName.includes('[관전]') || member.displayName.includes('[대기]'))) return;

    // Time tracking logic
    if (newState.channelId && !excludedChannelIds.includes(newState.channelId)) {
        if (!channelActivityTime.has(userId)) {
            channelActivityTime.set(userId, { startTime: now, totalTime: 0 });
        } else if (!channelActivityTime.get(userId).startTime) {
            channelActivityTime.get(userId).startTime = now;
        }
    } else if (oldState.channelId && !excludedChannelIds.includes(oldState.channelId)) {
        if (channelActivityTime.has(userId) && channelActivityTime.get(userId).startTime) {
            const userActivity = channelActivityTime.get(userId);
            userActivity.totalTime += now - userActivity.startTime;
            userActivity.startTime = null;
        }
    }

    debounceSaveActivityData();
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    const userId = newMember.id;
    const now = Date.now();

    if (newMember.displayName.includes('[관전]') || newMember.displayName.includes('[대기]')) {
        if (channelActivityTime.has(userId) && channelActivityTime.get(userId).startTime) {
            const userActivity = channelActivityTime.get(userId);
            userActivity.totalTime += now - userActivity.startTime;
            userActivity.startTime = null;
        }
    } else {
        const voiceState = newMember.voice;
        if (voiceState && voiceState.channelId && !excludedChannelIds.includes(voiceState.channelId)) {
            if (!channelActivityTime.has(userId)) {
                channelActivityTime.set(userId, { startTime: now, totalTime: 0 });
            } else if (!channelActivityTime.get(userId).startTime) {
                channelActivityTime.get(userId).startTime = now;
            }
            debounceSaveActivityData();
        }
    }
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (newChannel.type === ChannelType.GuildVoice) { // ChannelType 올바르게 사용
        if (oldChannel.name !== newChannel.name) {
            const membersInChannel = await getVoiceChannelMembers(newChannel);
            logActivity(`🔄 음성채널 이름이 변경되었습니다: \`${oldChannel.name}\` → \`${newChannel.name}\``, membersInChannel);
        }
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
        interaction.user.id !== '592666673627004939') {
        await interaction.reply({
            content: "이 명령어를 실행할 권한이 없습니다.(관리자용)",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    try {
        if (commandName === "gap_list") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").split(',').map(r => r.trim());
            const guild = interaction.guild;

            await initializeActivityData(guild);

            const members = await guild.members.fetch();
            const roleMembers = members.filter(member => member.roles.cache.some(r => role.includes(r.name)));

            saveActivityData();
            const activityData = loadMapFromJSON(activityFilePath);
            const roleActivityConfig = loadJSON(configFilePath);
            const minActivityTime = roleActivityConfig[role] ? roleActivityConfig[role] * 60 * 60 * 1000 : 0;

            const activeUsers = [];
            const inactiveUsers = [];

            roleMembers.forEach(member => {
                const userId = member.user.id;
                const activity = activityData.get(userId) || { totalTime: 0 };
                const userData = {
                    userId: userId,
                    nickname: member.displayName,
                    totalTime: activity.totalTime
                };

                if (userData.totalTime >= minActivityTime) {
                    activeUsers.push(userData);
                } else {
                    inactiveUsers.push(userData);
                }
            });

            activeUsers.sort((a, b) => b.totalTime - a.totalTime);
            inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);

            await sendActivityEmbed(interaction, activeUsers, inactiveUsers, role);

        } else if (commandName === "gap_config") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").replace(/@/g, '');
            const hours = interaction.options.getInteger("hours");
            roleActivityConfig[role] = hours;

            saveJSON(configFilePath, roleActivityConfig);

            await interaction.followUp({
                content: `역할 ${role} 의 최소 활동시간을 ${hours} 시간으로 설정 했습니다!`,
                flags: MessageFlags.Ephemeral,
            });

        } else if (commandName === "gap_reset") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").replace(/@/g, '');
            const members = interaction.guild.members.cache.filter(member => member.roles.cache.some(r => r.name === role));

            members.forEach(member => {
                if (channelActivityTime.has(member.user.id)) {
                    channelActivityTime.delete(member.user.id);
                }
            });

            await clearAndReinitializeActivityData(role);

            await interaction.followUp({
                content: `역할 ${role} 의 모든 사용자의 활동 시간이 초기화되었습니다.`,
                flags: MessageFlags.Ephemeral,
            });

        } else if (commandName === "체크") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const user = interaction.options.getUser("user");
            const userId = user.id;

            saveActivityData();
            const activityData = loadMapFromJSON(activityFilePath);
            const activity = activityData.get(userId) || { totalTime: 0 };

            const totalTime = activity.totalTime;
            const formattedTime = formatTime(totalTime);

            await interaction.followUp({
                content: `${user.username}님의 총 활동 시간은 ${formattedTime} 입니다.`,
                flags: MessageFlags.Ephemeral,
            });

        } else if (commandName === "gap_save") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            await saveActivityData();
            await clearAndReinitializeActivityData();

            await interaction.followUp({
                content: "활동 데이터가 최신화되었습니다.",
                flags: MessageFlags.Ephemeral,
            });
        }

    } catch (error) {
        console.error("Error handling interaction:", error);
        await interaction.reply({
            content: "요청 수행 중 에러 발생!",
            flags: MessageFlags.Ephemeral,
        });
    }
});

client.on(Events.ChannelCreate, (channel) => {
    if (channel.type === 'GUILD_VOICE') {
        logActivity(`🤖 봇이 음성채널 ${channel.name}을 생성했습니다.`, []);
    }
});

keepAlive();
client.login(process.env.TOKEN);

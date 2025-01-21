# 봇 위치
cd home/discord_bot/check_activity/

# 봇 실행
/home/yungsu22276/.nvm/versions/node/v23.5.0/bin/node /home/yungsu22276/home/discord_bot/check_activity/index.js
tmux 로 계속 재실행 하기 때문에

sudo kill -9 $(sudo lsof -t -i :3000)

로 종료 시 코드 재시작 됨(PID 가 계속 변경되며 재시작 함)

# 명령어 변경 시
/home/yungsu22276/.nvm/versions/node/v23.5.0/bin/node /home/yungsu22276/home/discord_bot/check_activity/deploy-commands.js

# Kill a process in Linux
sudo kill -9 $(sudo lsof -t -i :3000)

# 봇 세션 등록
tmux new-session -s discord_bot

# 로그 확인
pm2 logs discord_bot

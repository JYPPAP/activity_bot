// server.js - 봇을 활성 상태로 유지하는 간단한 웹 서버
import express from 'express';
import { logger } from './config/logger-termux.js';

/**
 * 봇을 활성 상태로 유지하기 위한 Express 서버를 시작합니다.
 */
export const keepAlive = () => {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // 기본 라우트 설정
  app.get('/', (req, res) => {
    res.send('봇이 활성 상태입니다!');
  });

  // 건강 상태 확인 엔드포인트
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
  });

  // 서버 시작
  app.listen(PORT, () => {
    // Terminal output - server status only  
    console.log(`🌐 Express 서버 시작: http://localhost:${PORT}`);
    logger.info('Express 서버 시작 완료', { component: 'KeepAlive', port: PORT, uptime: process.uptime() });
  });
};
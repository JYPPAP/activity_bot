// src/services/eventManager.js - 이벤트 관리 서비스
export class EventManager {
  constructor(client) {
    this.client = client;
    this.handlers = new Map();
  }

  /**
   * 이벤트 핸들러를 등록합니다.
   * @param {string} event - 이벤트 이름
   * @param {Function} handler - 이벤트 핸들러 함수
   */
  registerHandler(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    
    this.handlers.get(event).push(handler);
  }

  /**
   * 모든 이벤트 핸들러를 초기화합니다.
   */
  initialize() {
    for (const [event, handlers] of this.handlers.entries()) {
      this.client.on(event, async (...args) => {
        try {
          // 등록된 모든 핸들러 실행
          for (const handler of handlers) {
            await handler(...args);
          }
        } catch (error) {
          console.error(`이벤트 핸들러 오류 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 특정 이벤트의 모든 핸들러를 제거합니다.
   * @param {string} event - 제거할 이벤트 이름
   */
  clearHandlers(event) {
    if (this.handlers.has(event)) {
      this.handlers.delete(event);
    }
  }

  /**
   * 모든 이벤트 핸들러를 제거합니다.
   */
  clearAllHandlers() {
    this.handlers.clear();
  }
}
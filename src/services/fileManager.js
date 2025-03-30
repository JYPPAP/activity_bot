// src/services/fileManager.js - 파일 관리 서비스
import fs from 'fs';

export class FileManager {
  /**
   * JSON 파일에서 데이터를 로드합니다.
   * @param {string} filePath - 로드할 JSON 파일 경로
   * @returns {Object} - 로드된 JSON 데이터 객체
   */
  loadJSON(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.error("파일 데이터 파싱 오류:", error);
      }
    }
    return {};
  }

  /**
   * 데이터를 JSON 파일로 저장합니다.
   * @param {string} filePath - 저장할 JSON 파일 경로
   * @param {Object} data - 저장할 데이터 객체
   */
  saveJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("파일 저장 오류:", error);
    }
  }

  /**
   * Map 객체를 JSON 파일에서 로드합니다.
   * @param {string} filePath - 로드할 JSON 파일 경로
   * @returns {Map} - 로드된 데이터로 생성된 Map 객체
   */
  loadMapFromJSON(filePath) {
    const jsonData = this.loadJSON(filePath);
    return new Map(Object.entries(jsonData));
  }

  /**
   * Map 객체를 JSON 파일로 저장합니다.
   * @param {string} filePath - 저장할 JSON 파일 경로
   * @param {Map} mapData - 저장할 Map 객체
   */
  saveMapToJSON(filePath, mapData) {
    const jsonData = Object.fromEntries(mapData);
    this.saveJSON(filePath, jsonData);
  }

  /**
   * 파일이 존재하는지 확인합니다.
   * @param {string} filePath - 확인할 파일 경로
   * @returns {boolean} - 파일 존재 여부
   */
  fileExists(filePath) {
    return fs.existsSync(filePath);
  }
}
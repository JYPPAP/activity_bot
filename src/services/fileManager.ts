// src/services/fileManager.ts - 파일 관리 서비스 (TypeScript)
import fs from 'fs';
import path from 'path';
// import { promises as fsPromises } from 'fs'; // Unused

// ====================
// 파일 관리 옵션 타입
// ====================

export interface FileLoadOptions {
  encoding?: BufferEncoding;
  fallback?: any;
  validateJSON?: boolean;
  throwOnError?: boolean;
}

export interface FileSaveOptions {
  encoding?: BufferEncoding;
  indent?: number;
  createPath?: boolean;
  backup?: boolean;
  atomic?: boolean;
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  size?: number;
  lastModified?: Date;
}

export interface DirectoryOptions {
  recursive?: boolean;
  mode?: number;
}

export interface FileWatchOptions {
  persistent?: boolean;
  interval?: number;
  callback?: (eventType: string, filename: string) => void;
}

// ====================
// 파일 정보 타입
// ====================

export interface FileInfo {
  path: string;
  exists: boolean;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  lastModified: Date;
  extension: string;
  basename: string;
  dirname: string;
}

export interface DirectoryInfo {
  path: string;
  exists: boolean;
  isEmpty: boolean;
  filesCount: number;
  directoriesCount: number;
  totalSize: number;
  lastModified: Date;
}

// ====================
// 파일 관리 서비스 클래스
// ====================

export class FileManager {
  private static readonly DEFAULT_ENCODING: BufferEncoding = 'utf8';
  private static readonly DEFAULT_INDENT = 2;
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  private readonly watchedFiles: Map<string, fs.FSWatcher> = new Map();

  /**
   * JSON 파일에서 데이터를 로드합니다.
   * @param filePath - 로드할 JSON 파일 경로
   * @param options - 로드 옵션
   * @returns 로드된 JSON 데이터 객체
   */
  loadJSON<T = any>(filePath: string, options: FileLoadOptions = {}): T {
    const {
      encoding = FileManager.DEFAULT_ENCODING,
      fallback = {},
      validateJSON = true,
      throwOnError = false,
    } = options;

    try {
      if (!this.fileExists(filePath)) {
        if (throwOnError) {
          throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
        }
        return fallback as T;
      }

      // 파일 크기 검사
      const stats = fs.statSync(filePath);
      if (stats.size > FileManager.MAX_FILE_SIZE) {
        throw new Error(`파일이 너무 큽니다: ${filePath} (${stats.size} bytes)`);
      }

      const data = fs.readFileSync(filePath, encoding);

      if (validateJSON && !this.isValidJSON(data)) {
        throw new Error(`유효하지 않은 JSON 형식: ${filePath}`);
      }

      return JSON.parse(data) as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FileManager] JSON 로드 오류 (${filePath}):`, errorMessage);

      if (throwOnError) {
        throw error;
      }

      return fallback as T;
    }
  }

  /**
   * 데이터를 JSON 파일로 저장합니다.
   * @param filePath - 저장할 JSON 파일 경로
   * @param data - 저장할 데이터 객체
   * @param options - 저장 옵션
   * @returns 저장 성공 여부
   */
  saveJSON(filePath: string, data: any, options: FileSaveOptions = {}): boolean {
    const {
      encoding = FileManager.DEFAULT_ENCODING,
      indent = FileManager.DEFAULT_INDENT,
      createPath = true,
      backup = false,
      atomic = false,
    } = options;

    try {
      // 디렉토리 생성
      if (createPath) {
        const dirname = path.dirname(filePath);
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }
      }

      // 백업 생성
      if (backup && this.fileExists(filePath)) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        fs.copyFileSync(filePath, backupPath);
      }

      const jsonString = JSON.stringify(data, null, indent);

      if (atomic) {
        // 원자적 쓰기: 임시 파일에 쓰고 이름 변경
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tempPath, jsonString, encoding);
        fs.renameSync(tempPath, filePath);
      } else {
        fs.writeFileSync(filePath, jsonString, encoding);
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FileManager] JSON 저장 오류 (${filePath}):`, errorMessage);
      return false;
    }
  }

  /**
   * Map 객체를 JSON 파일에서 로드합니다.
   * @param filePath - 로드할 JSON 파일 경로
   * @param options - 로드 옵션
   * @returns 로드된 데이터로 생성된 Map 객체
   */
  loadMapFromJSON<K = string, V = any>(filePath: string, options: FileLoadOptions = {}): Map<K, V> {
    try {
      const jsonData = this.loadJSON<Record<string, V>>(filePath, options);

      if (!jsonData || typeof jsonData !== 'object') {
        return new Map<K, V>();
      }

      return new Map(Object.entries(jsonData) as [K, V][]);
    } catch (error) {
      console.error(`[FileManager] Map 로드 오류 (${filePath}):`, error);
      return new Map<K, V>();
    }
  }

  /**
   * Map 객체를 JSON 파일로 저장합니다.
   * @param filePath - 저장할 JSON 파일 경로
   * @param mapData - 저장할 Map 객체
   * @param options - 저장 옵션
   * @returns 저장 성공 여부
   */
  saveMapToJSON<K = string, V = any>(
    filePath: string,
    mapData: Map<K, V>,
    options: FileSaveOptions = {}
  ): boolean {
    try {
      const jsonData = Object.fromEntries(mapData);
      return this.saveJSON(filePath, jsonData, options);
    } catch (error) {
      console.error(`[FileManager] Map 저장 오류 (${filePath}):`, error);
      return false;
    }
  }

  /**
   * 파일이 존재하는지 확인합니다.
   * @param filePath - 확인할 파일 경로
   * @returns 파일 존재 여부
   */
  fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }

  /**
   * 디렉토리가 존재하는지 확인합니다.
   * @param dirPath - 확인할 디렉토리 경로
   * @returns 디렉토리 존재 여부
   */
  directoryExists(dirPath: string): boolean {
    try {
      const stats = fs.statSync(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * 파일 정보를 가져옵니다.
   * @param filePath - 파일 경로
   * @returns 파일 정보 객체
   */
  getFileInfo(filePath: string): FileInfo | null {
    try {
      const exists = this.fileExists(filePath);

      if (!exists) {
        return {
          path: filePath,
          exists: false,
          size: 0,
          isDirectory: false,
          isFile: false,
          lastModified: new Date(0),
          extension: path.extname(filePath),
          basename: path.basename(filePath),
          dirname: path.dirname(filePath),
        };
      }

      const stats = fs.statSync(filePath);

      return {
        path: filePath,
        exists: true,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        lastModified: stats.mtime,
        extension: path.extname(filePath),
        basename: path.basename(filePath),
        dirname: path.dirname(filePath),
      };
    } catch (error) {
      console.error(`[FileManager] 파일 정보 조회 오류 (${filePath}):`, error);
      return null;
    }
  }

  /**
   * 디렉토리 정보를 가져옵니다.
   * @param dirPath - 디렉토리 경로
   * @returns 디렉토리 정보 객체
   */
  getDirectoryInfo(dirPath: string): DirectoryInfo | null {
    try {
      const exists = this.directoryExists(dirPath);

      if (!exists) {
        return {
          path: dirPath,
          exists: false,
          isEmpty: true,
          filesCount: 0,
          directoriesCount: 0,
          totalSize: 0,
          lastModified: new Date(0),
        };
      }

      const items = fs.readdirSync(dirPath);
      let filesCount = 0;
      let directoriesCount = 0;
      let totalSize = 0;
      let lastModified = new Date(0);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isFile()) {
          filesCount++;
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          directoriesCount++;
        }

        if (stats.mtime > lastModified) {
          lastModified = stats.mtime;
        }
      }

      return {
        path: dirPath,
        exists: true,
        isEmpty: items.length === 0,
        filesCount,
        directoriesCount,
        totalSize,
        lastModified,
      };
    } catch (error) {
      console.error(`[FileManager] 디렉토리 정보 조회 오류 (${dirPath}):`, error);
      return null;
    }
  }

  /**
   * 디렉토리를 생성합니다.
   * @param dirPath - 생성할 디렉토리 경로
   * @param options - 생성 옵션
   * @returns 생성 성공 여부
   */
  createDirectory(dirPath: string, options: DirectoryOptions = {}): boolean {
    const { recursive = true, mode = 0o755 } = options;

    try {
      if (!this.directoryExists(dirPath)) {
        fs.mkdirSync(dirPath, { recursive, mode });
        return true;
      }
      return true; // 이미 존재함
    } catch (error) {
      console.error(`[FileManager] 디렉토리 생성 오류 (${dirPath}):`, error);
      return false;
    }
  }

  /**
   * 파일을 삭제합니다.
   * @param filePath - 삭제할 파일 경로
   * @returns 삭제 성공 여부
   */
  deleteFile(filePath: string): boolean {
    try {
      if (this.fileExists(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return true; // 파일이 존재하지 않음
    } catch (error) {
      console.error(`[FileManager] 파일 삭제 오류 (${filePath}):`, error);
      return false;
    }
  }

  /**
   * 디렉토리를 삭제합니다.
   * @param dirPath - 삭제할 디렉토리 경로
   * @param recursive - 재귀적 삭제 여부
   * @returns 삭제 성공 여부
   */
  deleteDirectory(dirPath: string, recursive: boolean = true): boolean {
    try {
      if (this.directoryExists(dirPath)) {
        fs.rmSync(dirPath, { recursive, force: true });
        return true;
      }
      return true; // 디렉토리가 존재하지 않음
    } catch (error) {
      console.error(`[FileManager] 디렉토리 삭제 오류 (${dirPath}):`, error);
      return false;
    }
  }

  /**
   * 파일을 복사합니다.
   * @param sourcePath - 원본 파일 경로
   * @param destPath - 대상 파일 경로
   * @param createPath - 대상 경로 생성 여부
   * @returns 복사 성공 여부
   */
  copyFile(sourcePath: string, destPath: string, createPath: boolean = true): boolean {
    try {
      if (!this.fileExists(sourcePath)) {
        throw new Error(`원본 파일이 존재하지 않습니다: ${sourcePath}`);
      }

      if (createPath) {
        const destDir = path.dirname(destPath);
        if (!this.directoryExists(destDir)) {
          this.createDirectory(destDir);
        }
      }

      fs.copyFileSync(sourcePath, destPath);
      return true;
    } catch (error) {
      console.error(`[FileManager] 파일 복사 오류 (${sourcePath} -> ${destPath}):`, error);
      return false;
    }
  }

  /**
   * 파일을 이동합니다.
   * @param sourcePath - 원본 파일 경로
   * @param destPath - 대상 파일 경로
   * @param createPath - 대상 경로 생성 여부
   * @returns 이동 성공 여부
   */
  moveFile(sourcePath: string, destPath: string, createPath: boolean = true): boolean {
    try {
      if (!this.fileExists(sourcePath)) {
        throw new Error(`원본 파일이 존재하지 않습니다: ${sourcePath}`);
      }

      if (createPath) {
        const destDir = path.dirname(destPath);
        if (!this.directoryExists(destDir)) {
          this.createDirectory(destDir);
        }
      }

      fs.renameSync(sourcePath, destPath);
      return true;
    } catch (error) {
      console.error(`[FileManager] 파일 이동 오류 (${sourcePath} -> ${destPath}):`, error);
      return false;
    }
  }

  /**
   * 파일을 검증합니다.
   * @param filePath - 검증할 파일 경로
   * @returns 검증 결과
   */
  validateFile(filePath: string): FileValidationResult {
    try {
      if (!this.fileExists(filePath)) {
        return {
          isValid: false,
          error: '파일이 존재하지 않습니다',
        };
      }

      const stats = fs.statSync(filePath);

      if (stats.size === 0) {
        return {
          isValid: false,
          error: '파일이 비어있습니다',
          size: 0,
          lastModified: stats.mtime,
        };
      }

      if (stats.size > FileManager.MAX_FILE_SIZE) {
        return {
          isValid: false,
          error: '파일이 너무 큽니다',
          size: stats.size,
          lastModified: stats.mtime,
        };
      }

      return {
        isValid: true,
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * JSON 문자열이 유효한지 검사합니다.
   * @param jsonString - 검사할 JSON 문자열
   * @returns 유효성 여부
   */
  private isValidJSON(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 파일 목록을 가져옵니다.
   * @param dirPath - 디렉토리 경로
   * @param filter - 파일 필터 함수
   * @returns 파일 목록
   */
  listFiles(dirPath: string, filter?: (filename: string) => boolean): string[] {
    try {
      if (!this.directoryExists(dirPath)) {
        return [];
      }

      const items = fs.readdirSync(dirPath);
      const files = items.filter((item) => {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);
        return stats.isFile() && (!filter || filter(item));
      });

      return files;
    } catch (error) {
      console.error(`[FileManager] 파일 목록 조회 오류 (${dirPath}):`, error);
      return [];
    }
  }

  /**
   * 하위 디렉토리 목록을 가져옵니다.
   * @param dirPath - 디렉토리 경로
   * @param filter - 디렉토리 필터 함수
   * @returns 하위 디렉토리 목록
   */
  listDirectories(dirPath: string, filter?: (dirname: string) => boolean): string[] {
    try {
      if (!this.directoryExists(dirPath)) {
        return [];
      }

      const items = fs.readdirSync(dirPath);
      const directories = items.filter((item) => {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);
        return stats.isDirectory() && (!filter || filter(item));
      });

      return directories;
    } catch (error) {
      console.error(`[FileManager] 디렉토리 목록 조회 오류 (${dirPath}):`, error);
      return [];
    }
  }

  /**
   * 파일 내용을 읽습니다.
   * @param filePath - 읽을 파일 경로
   * @param encoding - 인코딩
   * @returns 파일 내용
   */
  readFile(filePath: string, encoding: BufferEncoding = 'utf8'): string | null {
    try {
      if (!this.fileExists(filePath)) {
        return null;
      }

      return fs.readFileSync(filePath, encoding);
    } catch (error) {
      console.error(`[FileManager] 파일 읽기 오류 (${filePath}):`, error);
      return null;
    }
  }

  /**
   * 파일에 내용을 씁니다.
   * @param filePath - 쓸 파일 경로
   * @param content - 쓸 내용
   * @param encoding - 인코딩
   * @returns 쓰기 성공 여부
   */
  writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): boolean {
    try {
      const dirname = path.dirname(filePath);
      if (!this.directoryExists(dirname)) {
        this.createDirectory(dirname);
      }

      fs.writeFileSync(filePath, content, encoding);
      return true;
    } catch (error) {
      console.error(`[FileManager] 파일 쓰기 오류 (${filePath}):`, error);
      return false;
    }
  }

  /**
   * 파일을 감시합니다.
   * @param filePath - 감시할 파일 경로
   * @param callback - 변경 시 호출될 콜백
   * @returns 감시 해제 함수
   */
  watchFile(
    filePath: string,
    callback: (eventType: string, filename: string | null) => void
  ): () => void {
    try {
      if (this.watchedFiles.has(filePath)) {
        this.unwatchFile(filePath);
      }

      const watcher = fs.watch(filePath, callback);
      this.watchedFiles.set(filePath, watcher);

      return () => this.unwatchFile(filePath);
    } catch (error) {
      console.error(`[FileManager] 파일 감시 설정 오류 (${filePath}):`, error);
      return () => {};
    }
  }

  /**
   * 파일 감시를 해제합니다.
   * @param filePath - 감시 해제할 파일 경로
   */
  unwatchFile(filePath: string): void {
    try {
      const watcher = this.watchedFiles.get(filePath);
      if (watcher) {
        watcher.close();
        this.watchedFiles.delete(filePath);
      }
    } catch (error) {
      console.error(`[FileManager] 파일 감시 해제 오류 (${filePath}):`, error);
    }
  }

  /**
   * 모든 파일 감시를 해제합니다.
   */
  unwatchAllFiles(): void {
    for (const [filePath, watcher] of this.watchedFiles) {
      try {
        watcher.close();
      } catch (error) {
        console.error(`[FileManager] 파일 감시 해제 오류 (${filePath}):`, error);
      }
    }
    this.watchedFiles.clear();
  }

  /**
   * 파일 크기를 가져옵니다.
   * @param filePath - 파일 경로
   * @returns 파일 크기 (바이트)
   */
  getFileSize(filePath: string): number {
    try {
      if (!this.fileExists(filePath)) {
        return 0;
      }

      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (error) {
      console.error(`[FileManager] 파일 크기 조회 오류 (${filePath}):`, error);
      return 0;
    }
  }

  /**
   * 파일 또는 디렉토리가 비어있는지 확인합니다.
   * @param targetPath - 확인할 경로
   * @returns 비어있으면 true
   */
  isEmpty(targetPath: string): boolean {
    try {
      if (!this.fileExists(targetPath)) {
        return true;
      }

      const stats = fs.statSync(targetPath);

      if (stats.isFile()) {
        return stats.size === 0;
      } else if (stats.isDirectory()) {
        const items = fs.readdirSync(targetPath);
        return items.length === 0;
      }

      return true;
    } catch (error) {
      console.error(`[FileManager] 비어있음 확인 오류 (${targetPath}):`, error);
      return true;
    }
  }

  /**
   * 경로를 정규화합니다.
   * @param filePath - 정규화할 경로
   * @returns 정규화된 경로
   */
  normalizePath(filePath: string): string {
    return path.normalize(filePath);
  }

  /**
   * 상대 경로를 절대 경로로 변환합니다.
   * @param filePath - 변환할 경로
   * @returns 절대 경로
   */
  getAbsolutePath(filePath: string): string {
    return path.resolve(filePath);
  }

  /**
   * 파일 확장자를 가져옵니다.
   * @param filePath - 파일 경로
   * @returns 파일 확장자
   */
  getFileExtension(filePath: string): string {
    return path.extname(filePath);
  }

  /**
   * 파일명(확장자 제외)을 가져옵니다.
   * @param filePath - 파일 경로
   * @returns 파일명
   */
  getFileNameWithoutExtension(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
  }

  /**
   * 임시 파일 경로를 생성합니다.
   * @param prefix - 접두사
   * @param extension - 확장자
   * @returns 임시 파일 경로
   */
  getTempFilePath(prefix: string = 'tmp', extension: string = '.tmp'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `${prefix}_${timestamp}_${random}${extension}`;

    return path.join(process.cwd(), 'temp', filename);
  }

  /**
   * 정리 작업을 수행합니다.
   */
  cleanup(): void {
    try {
      this.unwatchAllFiles();
      console.log('[FileManager] 정리 작업 완료');
    } catch (error) {
      console.error('[FileManager] 정리 작업 오류:', error);
    }
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 파일 크기를 사람이 읽기 쉬운 형태로 변환합니다.
 * @param bytes - 바이트 수
 * @returns 형식화된 크기 문자열
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 파일 경로가 안전한지 확인합니다.
 * @param filePath - 확인할 파일 경로
 * @returns 안전하면 true
 */
export function isPathSafe(filePath: string): boolean {
  const normalized = path.normalize(filePath);

  // 상위 디렉토리 접근 시도 확인
  if (normalized.includes('..')) {
    return false;
  }

  // 절대 경로 확인 (필요에 따라 허용/불허용 결정)
  if (path.isAbsolute(normalized)) {
    return true; // 절대 경로 허용
  }

  return true;
}

/**
 * 파일 경로에서 확장자를 기반으로 MIME 타입을 추정합니다.
 * @param filePath - 파일 경로
 * @returns 추정된 MIME 타입
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes: { [key: string]: string } = {
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.css': 'text/css',
    '.xml': 'application/xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

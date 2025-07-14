declare module 'lowdb' {
  interface LowdbAdapter {
    read(): Promise<any>;
    write(data: any): Promise<void>;
  }

  interface LowdbSyncAdapter {
    read(): any;
    write(data: any): void;
  }

  interface LowdbDatabase {
    get(path: string): any;
    set(path: string, value: any): this;
    value(): any;
    write(): Promise<void>;
    read(): Promise<void>;
    getState(): any;
    setState(state: any): this;
  }

  function low(adapter: LowdbAdapter): Promise<LowdbDatabase>;
  function low(adapter: LowdbSyncAdapter): LowdbDatabase;

  export default low;
}

declare module 'lowdb/adapters/FileSync.js' {
  class FileSync {
    constructor(
      filename: string,
      options?: {
        defaultValue?: any;
        serialize?: (data: any) => string;
        deserialize?: (data: string) => any;
      }
    );
  }
  export default FileSync;
}

declare module 'ssh2-sftp-client' {
  export default class SftpClient {
    connect(config: Record<string, unknown>): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<string>;
    put(localPath: string, remotePath: string): Promise<string>;
    end(): Promise<boolean>;
  }
}

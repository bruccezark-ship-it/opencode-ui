export type GitflowFileSystem = {
  read(path: string): Promise<string | undefined>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  isDirectory(path: string): Promise<boolean>
}

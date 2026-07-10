export function getDataDir(): string {
  return process.env.QUBE_DATA_DIR || process.cwd();
}

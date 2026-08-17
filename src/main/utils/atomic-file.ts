import fs from 'fs';
import path from 'path';

/**
 * Atomically write a JSON file with backup support.
 * Steps: backup -> write temp -> fsync -> rename -> fsync dir
 */
export function writeJsonAtomic(filePath: string, data: unknown, backupPath?: string): void {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  // Create backup first if requested and file exists
  if (backupPath && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const content = JSON.stringify(data, null, 2);
  
  try {
    // Write to temp file
    fs.writeFileSync(tmpPath, content, 'utf-8');
    
    // fsync to ensure data is flushed to disk (best-effort: fsync can fail
    // with EPERM on some Windows filesystems, which must not abort the write)
    try {
      const fd = fs.openSync(tmpPath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      // ignore fsync errors - the write itself already succeeded
    }
    
    // Atomic rename
    fs.renameSync(tmpPath, filePath);
    
    // fsync the directory to ensure the rename is persisted.
    // NOTE: opening/fsyncing a directory is not supported on Windows (EPERM),
    // so this is strictly best-effort.
    try {
      const dirFd = fs.openSync(dir, 'r');
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {
      // ignore - not supported on Windows
    }
  } catch (err) {
    // Clean up temp file if it exists
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    throw err;
  }
}

/**
 * Restore from backup file.
 */
export function restoreFromBackup(filePath: string, backupPath: string): boolean {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, filePath);
    return true;
  }
  return false;
}

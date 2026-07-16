export interface FileNode {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
  children: FileNode[];
  file_count: number;
  last_modified: number | null;
}

export interface DriveInfo {
  letter: string;
  mount_point: string;
  total_space: number;
  free_space: number;
  used_space: number;
  name: string;
}

export interface ScanProgress {
  current_path: string;
  files_scanned: number;
  bytes_scanned: number;
  dirs_scanned: number;
}

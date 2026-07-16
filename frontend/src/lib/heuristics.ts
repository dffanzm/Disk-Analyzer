export type RiskLevel = 'SAFE' | 'MEDIUM' | 'DANGER' | 'UNKNOWN';

export interface Insight {
  description: string;
  recommendation: string;
  risk: RiskLevel;
}

// A simple dictionary mapping lowercase folder/file names (or extensions) to insights.
const insightsDb: Record<string, Insight> = {
  // Developer Folders
  'node_modules': {
    description: 'Node.js package dependencies.',
    recommendation: 'Sangat aman dihapus jika Anda tidak sedang aktif mengerjakan proyek ini. Bisa di-install ulang kapan saja menggunakan "npm install".',
    risk: 'SAFE'
  },
  'target': {
    description: 'Kompilasi direktori proyek (biasanya Rust/Java).',
    recommendation: 'Aman dihapus. Sistem akan mem-build ulang otomatis saat proyek dijalankan kembali.',
    risk: 'SAFE'
  },
  'venv': {
    description: 'Python Virtual Environment.',
    recommendation: 'Aman dihapus jika Anda tahu cara membuatnya lagi (pip install -r requirements.txt).',
    risk: 'SAFE'
  },
  '.cache': {
    description: 'File cache aplikasi sementara.',
    recommendation: 'Sangat aman dihapus untuk membebaskan ruang memori. Aplikasi akan membuat ulang otomatis jika diperlukan.',
    risk: 'SAFE'
  },
  'cache': {
    description: 'Data cache.',
    recommendation: 'Umumnya aman dihapus. Kadang membuat aplikasi perlu mendownload ulang beberapa gambar/data.',
    risk: 'SAFE'
  },
  '__pycache__': {
    description: 'Python compiled bytecode.',
    recommendation: 'Sangat aman dihapus.',
    risk: 'SAFE'
  },
  // System / OS
  'temp': {
    description: 'File sementara sistem/aplikasi.',
    recommendation: 'Sangat aman dihapus. OS Windows sering lupa membersihkannya secara otomatis.',
    risk: 'SAFE'
  },
  'tmp': {
    description: 'File sementara.',
    recommendation: 'Aman untuk dihapus.',
    risk: 'SAFE'
  },
  'windows': {
    description: 'Sistem Operasi Utama Windows.',
    recommendation: 'JANGAN DIHAPUS! Akan merusak sistem operasi komputer Anda.',
    risk: 'DANGER'
  },
  'system32': {
    description: 'Komponen inti Windows.',
    recommendation: 'JANGAN DIHAPUS!',
    risk: 'DANGER'
  },
  'appdata': {
    description: 'Data konfigurasi dan file aplikasi tersembunyi.',
    recommendation: 'Hati-hati. Jangan hapus folder ini secara keseluruhan, namun Anda boleh mengecek sub-folder Temp atau Cache di dalamnya.',
    risk: 'DANGER'
  },
  'program files': {
    description: 'Direktori instalasi aplikasi bawaan OS.',
    recommendation: 'Hapus aplikasi melalui Settings -> Apps (Uninstall), bukan dihapus manual dari sini.',
    risk: 'DANGER'
  },
  'program files (x86)': {
    description: 'Direktori instalasi aplikasi bawaan OS 32-bit.',
    recommendation: 'Hapus aplikasi melalui Settings -> Apps (Uninstall), bukan manual.',
    risk: 'DANGER'
  },
  // Common Large Files
  'docker_data.vhdx': {
    description: 'Virtual Disk OS Linux milik Docker WSL2.',
    recommendation: 'Jangan hapus manual dari sini. Jika ingin membersihkan, gunakan Docker Desktop (Purge data) atau perintah WSL.',
    risk: 'DANGER'
  },
  'ext4.vhdx': {
    description: 'Virtual Disk untuk Windows Subsystem for Linux (WSL).',
    recommendation: 'Jangan hapus manual karena Linux Anda akan rusak/hilang.',
    risk: 'DANGER'
  },
  'pagefile.sys': {
    description: 'Virtual memory / RAM cadangan Windows.',
    recommendation: 'Sistem sedang menggunakannya. Jangan dihapus.',
    risk: 'DANGER'
  },
  'hiberfil.sys': {
    description: 'File mode Hibernasi Windows.',
    recommendation: 'Jika ukurannya terlalu besar dan Anda tidak butuh mode hibernate, nonaktifkan via command prompt (powercfg -h off).',
    risk: 'DANGER'
  },
  // Media / Generic
  'downloads': {
    description: 'Folder unduhan sistem.',
    recommendation: 'Periksa file Installer (.exe), ZIP, atau video lama yang sudah tidak terpakai dan hapus dengan aman.',
    risk: 'MEDIUM'
  },
  '$recycle.bin': {
    description: 'Tempat Sampah / Recycle Bin.',
    recommendation: 'Sangat aman dihapus. Ini sama seperti melakukan "Empty Recycle Bin".',
    risk: 'SAFE'
  }
};

/**
 * Get heuristic insight based on the file or folder name.
 */
export function getInsightForPath(name: string, isDir: boolean): Insight {
  const lowerName = name.toLowerCase();
  
  if (insightsDb[lowerName]) {
    return insightsDb[lowerName];
  }

  // Extensions based matches
  if (!isDir) {
    if (lowerName.endsWith('.iso')) {
      return {
        description: 'File Image CD/DVD atau Installer.',
        recommendation: 'Jika sudah di-install, file ini aman dihapus karena ukurannya biasanya sangat besar.',
        risk: 'MEDIUM'
      };
    }
    if (lowerName.endsWith('.zip') || lowerName.endsWith('.rar') || lowerName.endsWith('.7z')) {
      return {
        description: 'File Kompresi (Arsip).',
        recommendation: 'Jika isinya sudah diekstrak, file aslinya aman untuk dihapus.',
        risk: 'MEDIUM'
      };
    }
    if (lowerName.endsWith('.mp4') || lowerName.endsWith('.mkv')) {
      return {
        description: 'File Video.',
        recommendation: 'Video sering memakan banyak memori. Hapus jika sudah tidak ditonton.',
        risk: 'MEDIUM'
      };
    }
    if (lowerName.endsWith('.log')) {
      return {
        description: 'File Catatan/Log sistem aplikasi.',
        recommendation: 'Aman dihapus. Aplikasi akan membuat log baru secara otomatis.',
        risk: 'SAFE'
      };
    }
  } else {
    // Partial directory matches
    if (lowerName.includes('cache')) {
      return {
        description: 'Kemungkinan direktori Cache.',
        recommendation: 'Umumnya aman dihapus untuk membebaskan ruang disk.',
        risk: 'SAFE'
      };
    }
  }

  return {
    description: isDir ? 'Folder umum.' : 'File umum.',
    recommendation: 'Tidak ada informasi khusus. Pastikan Anda tahu apa isi file/folder ini sebelum menghapusnya.',
    risk: 'UNKNOWN'
  };
}

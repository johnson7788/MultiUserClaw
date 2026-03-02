'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Trash2,
  Download,
  Loader2,
  FolderOpen,
  Folder,
  FileText,
  Upload,
  FolderPlus,
  ChevronRight,
  Home,
  RefreshCw,
  FileImage,
  FileCode,
  FileArchive,
  FileSpreadsheet,
} from 'lucide-react';
import {
  browseWorkspace,
  getWorkspaceDownloadUrl,
  uploadToWorkspace,
  deleteWorkspacePath,
  createWorkspaceDir,
  getAccessToken,
} from '@/lib/api';
import type { WorkspaceItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function FilesPage() {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mkdirInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (path: string = currentPath) => {
    try {
      setLoading(true);
      const data = await browseWorkspace(path);
      setItems(data.items);
      setCurrentPath(data.path);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    load('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (path: string) => {
    load(path);
  };

  const handleDelete = async (item: WorkspaceItem) => {
    const label = item.type === 'directory' ? '文件夹' : '文件';
    if (!confirm(`确定删除${label} "${item.name}"？${item.type === 'directory' ? '（包含所有子文件）' : ''}`)) {
      return;
    }
    try {
      await deleteWorkspacePath(item.path);
      setItems((prev) => prev.filter((i) => i.path !== item.path));
    } catch {
      // ignore
    }
  };

  const handleDownload = async (item: WorkspaceItem) => {
    const url = getWorkspaceDownloadUrl(item.path);
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(url, { headers });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      // ignore
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadToWorkspace(files[i], currentPath, (pct) => {
          setUploadProgress(Math.round((i / files.length) * 100 + pct / files.length));
        });
      }
      await load();
    } catch {
      // ignore
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateDir = async () => {
    const name = newDirName.trim();
    if (!name) return;
    try {
      const dirPath = currentPath ? `${currentPath}/${name}` : name;
      await createWorkspaceDir(dirPath);
      setShowMkdir(false);
      setNewDirName('');
      await load();
    } catch {
      // ignore
    }
  };

  // Build breadcrumbs
  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  const formatSize = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return '';
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">文件管理</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMkdir(true)}
            disabled={loading}
          >
            <FolderPlus className="w-4 h-4 mr-1" />
            新建文件夹
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                {uploadProgress}%
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-1" />
                上传
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm text-muted-foreground flex-wrap">
        <button
          onClick={() => navigateTo('')}
          className="flex items-center gap-1 hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
        >
          <Home className="w-3.5 h-3.5" />
          workspace
        </button>
        {breadcrumbs.map((segment, idx) => {
          const path = breadcrumbs.slice(0, idx + 1).join('/');
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <React.Fragment key={path}>
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
              <button
                onClick={() => navigateTo(path)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  isLast
                    ? 'text-foreground font-medium'
                    : 'hover:text-foreground hover:bg-accent'
                }`}
              >
                {segment}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* New directory input */}
      {showMkdir && (
        <div className="flex items-center gap-2 mb-4">
          <Folder className="w-4 h-4 text-muted-foreground" />
          <input
            ref={mkdirInputRef}
            type="text"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateDir();
              if (e.key === 'Escape') {
                setShowMkdir(false);
                setNewDirName('');
              }
            }}
            placeholder="文件夹名称"
            className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <Button size="sm" onClick={handleCreateDir}>
            创建
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowMkdir(false);
              setNewDirName('');
            }}
          >
            取消
          </Button>
        </div>
      )}

      {/* File list */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FolderOpen className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">空文件夹</p>
          <p className="text-sm">点击上方"上传"或"新建文件夹"按钮开始使用</p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-14rem)]">
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.path}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors group"
              >
                {/* Icon */}
                <div className="flex-shrink-0">
                  {item.type === 'directory' ? (
                    <Folder className="w-5 h-5 text-blue-500" />
                  ) : (
                    <FileIcon name={item.name} contentType={item.content_type} />
                  )}
                </div>

                {/* Name - clickable for directories */}
                <div className="flex-1 min-w-0">
                  {item.type === 'directory' ? (
                    <button
                      onClick={() => navigateTo(item.path)}
                      className="text-sm font-medium truncate hover:underline text-left block w-full"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <p className="text-sm font-medium truncate">{item.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {item.type === 'file' && formatSize(item.size)}
                    {item.modified && (
                      <>
                        {item.type === 'file' && ' · '}
                        {formatDate(item.modified)}
                      </>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.type === 'file' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDownload(item)}
                      title="下载"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(item)}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function FileIcon({ name, contentType }: { name: string; contentType?: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const ct = contentType || '';

  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return <FileImage className="w-5 h-5 text-green-500" />;
  }
  if (
    ['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'md', 'sh'].includes(ext)
  ) {
    return <FileCode className="w-5 h-5 text-orange-500" />;
  }
  if (['zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'xz'].includes(ext)) {
    return <FileArchive className="w-5 h-5 text-yellow-500" />;
  }
  if (['csv', 'xls', 'xlsx', 'tsv'].includes(ext)) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
  }
  return <FileText className="w-5 h-5 text-muted-foreground" />;
}

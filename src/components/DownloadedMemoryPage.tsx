import { useEffect, useMemo, useState } from 'react';
import { BookCopy, HardDriveDownload, Import, Layers2, NotebookPen, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DownloadedMemoryNotebook, DownloadedMemoryPage as DownloadedMemoryPageData } from '@/types/memory';

interface DownloadedMemoryPageProps {
  notebooks: DownloadedMemoryNotebook[];
  onBackToStudio: () => void;
  onImportNotebook: (notebookId: string) => void;
  onImportPage: (notebookId: string, pageId: string) => void;
  onDeleteNotebook: (notebookId: string) => void;
  onRenameNotebook: (notebookId: string, nextNotebookName: string) => void;
}

function previewStrokeWidth(pressure: number) {
  const normalized = Number.isFinite(pressure) ? pressure : 0.5;
  return 0.18 + Math.max(0, normalized) * 0.42;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function NotebookStats({ notebook }: { notebook: DownloadedMemoryNotebook }) {
  const pointCount = notebook.pages.reduce((sum, page) => sum + page.pointCount, 0);
  const sourceLabel = notebook.deviceType === 'wacom' ? 'Wacom/tUHI' : 'Huion';

  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-neutral-400">
      <span>{notebook.pageCount} page{notebook.pageCount === 1 ? '' : 's'}</span>
      <span>{pointCount.toLocaleString()} points</span>
      <span>{sourceLabel}</span>
      <span>{formatDate(notebook.downloadedAt)}</span>
    </div>
  );
}

function PagePreview({ page }: { page: DownloadedMemoryPageData }) {
  const bounds = { minX: 1, minY: 1, maxX: 0, maxY: 0 };
  for (const stroke of page.strokes) {
    for (const point of stroke.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }

  const hasInk = page.pointCount > 0 && bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY;

  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-neutral-700 bg-[linear-gradient(180deg,#f7f7f2_0%,#ece9df_100%)] p-3">
      <div className="absolute inset-x-0 top-0 h-8 border-b border-amber-200/60 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_23px,rgba(180,83,9,0.12)_23px,rgba(180,83,9,0.12)_24px)]" />
      {hasInk ? (
        <svg viewBox="0 0 100 130" className="absolute inset-0 h-full w-full">
          {page.strokes.map((stroke, strokeIndex) => {
            if (stroke.points.length === 0) return null;

            if (stroke.points.length === 1) {
              const point = stroke.points[0];
              return (
                <circle
                  key={`${page.id}-${strokeIndex}`}
                  cx={10 + point.x * 80}
                  cy={16 + point.y * 104}
                  r={previewStrokeWidth(point.pressure) / 2}
                  fill="rgba(15,23,42,0.78)"
                />
              );
            }

            return (
              <g key={`${page.id}-${strokeIndex}`}>
                {stroke.points.slice(1).map((point, pointIndex) => {
                  const previous = stroke.points[pointIndex];
                  return (
                    <line
                      key={`${page.id}-${strokeIndex}-${pointIndex}`}
                      x1={10 + previous.x * 80}
                      y1={16 + previous.y * 104}
                      x2={10 + point.x * 80}
                      y2={16 + point.y * 104}
                      stroke="rgba(15,23,42,0.78)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={previewStrokeWidth(point.pressure)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">
          Empty page
        </div>
      )}
    </div>
  );
}

export function DownloadedMemoryPage({
  notebooks,
  onBackToStudio,
  onImportNotebook,
  onImportPage,
  onDeleteNotebook,
  onRenameNotebook,
}: DownloadedMemoryPageProps) {
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(notebooks[0]?.id ?? null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (notebooks.length === 0) {
      setSelectedNotebookId(null);
      return;
    }

    setSelectedNotebookId((current) => {
      if (current && notebooks.some((notebook) => notebook.id === current)) {
        return current;
      }
      return notebooks[0].id;
    });
  }, [notebooks]);

  const selectedNotebook = useMemo(() => (
    notebooks.find((notebook) => notebook.id === selectedNotebookId) ?? notebooks[0] ?? null
  ), [notebooks, selectedNotebookId]);

  useEffect(() => {
    setRenameDraft(selectedNotebook?.notebookName ?? '');
    setIsRenaming(false);
  }, [selectedNotebook?.id, selectedNotebook?.notebookName]);

  const commitNotebookRename = () => {
    if (!selectedNotebook) {
      return;
    }
    const trimmedName = renameDraft.trim();
    if (!trimmedName) {
      setRenameDraft(selectedNotebook.notebookName);
      setIsRenaming(false);
      return;
    }
    onRenameNotebook(selectedNotebook.id, trimmedName);
    setIsRenaming(false);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,#1f3a5b_0%,#101521_42%,#090b10_100%)] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <HardDriveDownload className="h-4 w-4" />
              Notebook Downloads
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Downloaded notebook library</h1>
            <p className="max-w-2xl text-sm text-neutral-400">
              Pages downloaded from Huion and Wacom/tUHI notebooks are stored here as separate notebook batches before you import them onto the canvas.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-neutral-700 bg-neutral-900/80 text-neutral-100 hover:bg-neutral-800"
            onClick={onBackToStudio}
          >
            Back to studio
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[320px,minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-neutral-800 bg-neutral-900/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            <NotebookPen className="h-3.5 w-3.5" />
            Downloaded notebooks
          </div>

          {notebooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900 px-4 py-8 text-center text-sm text-neutral-500">
              Use the tablet panel to download pages from a connected notebook into this library.
            </div>
          ) : (
            <div className="space-y-3">
              {notebooks.map((notebook) => {
                const selected = notebook.id === selectedNotebook?.id;
                return (
                  <button
                    key={notebook.id}
                    type="button"
                    onClick={() => setSelectedNotebookId(notebook.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                        : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-neutral-100">{notebook.notebookName}</div>
                        <div className="text-xs text-neutral-500">{notebook.deviceName}</div>
                      </div>
                      <BookCopy className="mt-0.5 h-4 w-4 text-neutral-500" />
                    </div>
                    <NotebookStats notebook={notebook} />
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto p-6">
          {!selectedNotebook ? (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/40 text-sm text-neutral-500">
              No downloaded notebooks yet.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-3xl border border-neutral-800 bg-[linear-gradient(180deg,rgba(20,23,31,0.98)_0%,rgba(12,14,20,0.98)_100%)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    {isRenaming ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitNotebookRename();
                            } else if (event.key === 'Escape') {
                              setRenameDraft(selectedNotebook.notebookName);
                              setIsRenaming(false);
                            }
                          }}
                          className="h-10 w-[280px] border-neutral-700 bg-neutral-950 text-base font-semibold text-white"
                          placeholder="Notebook name"
                        />
                        <Button
                          variant="outline"
                          className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                          onClick={commitNotebookRename}
                        >
                          Save name
                        </Button>
                        <Button
                          variant="outline"
                          className="border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                          onClick={() => {
                            setRenameDraft(selectedNotebook.notebookName);
                            setIsRenaming(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold text-white">{selectedNotebook.notebookName}</h2>
                        <Button
                          variant="outline"
                          className="border-neutral-700 bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800"
                          onClick={() => setIsRenaming(true)}
                        >
                          Rename
                        </Button>
                      </div>
                    )}
                    <NotebookStats notebook={selectedNotebook} />
                    <div className="text-xs text-neutral-500">
                      Canvas source size {selectedNotebook.pageWidth} x {selectedNotebook.pageHeight}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                      onClick={() => onImportNotebook(selectedNotebook.id)}
                    >
                      <Layers2 className="h-4 w-4" />
                      Import notebook
                    </Button>
                    <Button
                      variant="outline"
                      className="border-red-900 bg-red-950/30 text-red-200 hover:bg-red-950/50"
                      onClick={() => onDeleteNotebook(selectedNotebook.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {selectedNotebook.pages.map((page) => (
                  <section key={page.id} className="rounded-3xl border border-neutral-800 bg-neutral-900/80 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">Page {page.pageNum + 1}</div>
                        <div className="text-xs text-neutral-500">
                          {page.strokeCount} stroke{page.strokeCount === 1 ? '' : 's'} - {page.pointCount.toLocaleString()} points
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-neutral-700 bg-neutral-950 text-neutral-100 hover:bg-neutral-800"
                        onClick={() => onImportPage(selectedNotebook.id, page.id)}
                      >
                        <Import className="h-4 w-4" />
                        Import
                      </Button>
                    </div>
                    <PagePreview page={page} />
                  </section>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

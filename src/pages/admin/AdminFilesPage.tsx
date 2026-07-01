import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { DatabaseBackup, Download, FileUp, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import {
  deleteManagedFile,
  formatDateTime,
  getManagedFileDownloadUrl,
  getManagedFilesDashboard,
  getRuntimeExportUrl,
  importRuntimeArchive,
  restoreManagedBackup,
  updateRuntimeSecrets,
  uploadManagedFile,
  type ManagedFileCategory,
  type ManagedFileCategorySummary,
  type ManagedFilesDashboard,
} from "../../utils/adminAccess";

const categoryLabels: Record<ManagedFileCategory, { description: string; label: string }> = {
  articles: {
    description: "文章 JSON 数据。日常文章编辑仍建议使用文章管理页。",
    label: "文章数据",
  },
  "avatar-notes": {
    description: "AI 分身参考的 Markdown 文件，可追加、替换或删除。",
    label: "AI 参考文件",
  },
  "resume-data": {
    description: "加密简历页读取的结构化 JSON。",
    label: "简历数据 JSON",
  },
  "resume-pdf": {
    description: "下载简历时返回的真正 PDF 文件。",
    label: "简历 PDF",
  },
  "runtime-settings": {
    description: "API、模型和访问密码。保存后需要重启服务才会生效。",
    label: "运行配置/密钥",
  },
  "site-assets": {
    description: "站点 LOGO / favicon，当前第一版支持 SVG。",
    label: "LOGO / favicon",
  },
};

const uploadAccept: Partial<Record<ManagedFileCategory, string>> = {
  articles: ".json,application/json",
  "avatar-notes": ".md,.markdown,.txt,text/markdown,text/plain",
  "resume-data": ".json,application/json",
  "resume-pdf": ".pdf,application/pdf",
  "site-assets": ".svg,image/svg+xml",
};

const emptyDashboard: ManagedFilesDashboard = {
  categories: [],
  generatedAt: Date.now(),
};

const secretFields = [
  { key: "AVATAR_API_URL", label: "AI API URL" },
  { key: "AVATAR_API_KEY", label: "AI API Key" },
  { key: "AVATAR_MODEL", label: "主模型" },
  { key: "AVATAR_FALLBACK_MODEL", label: "降级模型" },
  { key: "RESUME_ACCESS_PASSWORD", label: "简历密码" },
  { key: "ADMIN_ACCESS_PASSWORD", label: "管理密码" },
];

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
};

type FileUploadControlProps = {
  category: ManagedFileCategory;
  disabled: boolean;
  label: string;
  onUpload: (category: ManagedFileCategory, file: File, kind?: "favicon" | "logo") => void;
};

function FileUploadControl({ category, disabled, label, onUpload }: FileUploadControlProps) {
  const [assetKind, setAssetKind] = useState<"favicon" | "logo">("favicon");

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    onUpload(category, file, category === "site-assets" ? assetKind : undefined);
  };

  return (
    <div className="admin-file-upload-row">
      {category === "site-assets" ? (
        <select disabled={disabled} onChange={(event) => setAssetKind(event.target.value === "logo" ? "logo" : "favicon")} value={assetKind}>
          <option value="favicon">favicon</option>
          <option value="logo">logo</option>
        </select>
      ) : null}
      <label className="admin-file-button">
        <FileUp size={16} />
        {label}
        <input accept={uploadAccept[category]} disabled={disabled} onChange={handleChange} type="file" />
      </label>
    </div>
  );
}

type ManagedCategoryCardProps = {
  category: ManagedFileCategorySummary;
  disabled: boolean;
  onDelete: (category: ManagedFileCategory, fileName: string) => void;
  onRestore: (category: ManagedFileCategory, id: string) => void;
  onUpload: (category: ManagedFileCategory, file: File, kind?: "favicon" | "logo") => void;
};

function ManagedCategoryCard({ category, disabled, onDelete, onRestore, onUpload }: ManagedCategoryCardProps) {
  const info = categoryLabels[category.category];
  const canUpload = category.category !== "runtime-settings";
  const canDeleteFiles = category.category === "avatar-notes" || category.category === "site-assets";
  const canDownloadCurrent = category.current.exists && !category.current.isDirectory;

  return (
    <article className="admin-control-panel admin-managed-file-card">
      <div className="admin-panel-title">
        <span>{category.category}</span>
        <h2>{info.label}</h2>
      </div>
      <p className="admin-muted-copy">{info.description}</p>
      <div className="admin-file-current">
        <DatabaseBackup size={18} />
        <span>
          <strong>{category.current.exists ? category.current.name : "当前文件不存在"}</strong>
          <em>
            {category.current.exists
              ? `${formatBytes(category.current.size)} · ${formatDateTime(category.current.updatedAt)}`
              : "上传后会自动创建运行文件"}
          </em>
        </span>
        {canDownloadCurrent ? (
          <a href={getManagedFileDownloadUrl(category.category)}>
            <Download size={15} />
            下载
          </a>
        ) : null}
      </div>
      {canUpload ? (
        <FileUploadControl category={category.category} disabled={disabled} label="上传/替换" onUpload={onUpload} />
      ) : null}
      {category.files.length ? (
        <div className="admin-file-list">
          {category.files.map((file) => (
            <div className="admin-file-row" key={file.path}>
              <span>
                <strong>{file.name}</strong>
                <em>{formatBytes(file.size)} · {formatDateTime(file.updatedAt)}</em>
              </span>
              {canDeleteFiles ? (
                <button disabled={disabled} onClick={() => onDelete(category.category, file.name)} type="button">
                  <Trash2 size={15} />
                  删除
                </button>
              ) : null}
              <a href={getManagedFileDownloadUrl(category.category, file.name)}>
                <Download size={15} />
                下载
              </a>
            </div>
          ))}
        </div>
      ) : null}
      <div className="admin-backup-list">
        <h3>历史版本</h3>
        {category.backups.length ? (
          category.backups.map((backup) => (
            <div className="admin-backup-row" key={backup.id}>
              <span>
                <strong>{backup.itemName}</strong>
                <em>{backup.action} · {formatBytes(backup.size)} · {formatDateTime(backup.createdAt)}</em>
              </span>
              <button disabled={disabled} onClick={() => onRestore(category.category, backup.id)} type="button">
                <RotateCcw size={15} />
                恢复
              </button>
            </div>
          ))
        ) : (
          <p className="admin-empty-inline">还没有历史版本。</p>
        )}
      </div>
    </article>
  );
}

export default function AdminFilesPage() {
  const [dashboard, setDashboard] = useState<ManagedFilesDashboard>(emptyDashboard);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [runtimeForm, setRuntimeForm] = useState<Record<string, string>>({});
  const runtimeCategory = useMemo(
    () => dashboard.categories.find((category) => category.category === "runtime-settings"),
    [dashboard.categories],
  );
  const fileCategories = dashboard.categories.filter((category) => category.category !== "runtime-settings");

  const refresh = async () => {
    setIsBusy(true);
    try {
      setDashboard(await getManagedFilesDashboard());
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "文件管理数据读取失败。");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const applyDashboard = (nextDashboard: ManagedFilesDashboard, nextMessage: string) => {
    setDashboard(nextDashboard);
    setMessage(nextMessage);
    setError("");
  };

  const handleUpload = async (category: ManagedFileCategory, file: File, kind?: "favicon" | "logo") => {
    setIsBusy(true);
    setMessage("");
    try {
      applyDashboard(await uploadManagedFile(category, file, { kind }), "文件已上传，旧版本已进入历史备份。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败。");
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportArchive = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!window.confirm("确定导入这个运行数据包吗？导入前会先备份当前运行数据，并采用合并覆盖方式保留包内没有的旧文件。")) return;

    setIsBusy(true);
    setMessage("");
    try {
      applyDashboard(await importRuntimeArchive(file), "运行数据包已导入。导入前的当前运行数据已备份。");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "运行数据导入失败。");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (category: ManagedFileCategory, fileName: string) => {
    if (!window.confirm(`确定删除 ${fileName} 吗？删除前会先创建备份。`)) return;
    setIsBusy(true);
    setMessage("");
    try {
      applyDashboard(await deleteManagedFile(category, fileName), "文件已删除，删除前版本已备份。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "文件删除失败。");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestore = async (category: ManagedFileCategory, id: string) => {
    if (!window.confirm("确定恢复这个历史版本吗？恢复前会先备份当前版本。")) return;
    setIsBusy(true);
    setMessage("");
    try {
      applyDashboard(await restoreManagedBackup(category, id), "历史版本已恢复，恢复前的当前版本也已备份。");
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "备份恢复失败。");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRuntimeSave = async () => {
    setIsBusy(true);
    setMessage("");
    try {
      applyDashboard(await updateRuntimeSecrets(runtimeForm), "运行配置已保存。请重启服务后再期待密钥/密码变更生效。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "运行配置保存失败。");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!runtimeCategory?.secretStatus) return;

    setRuntimeForm(
      Object.fromEntries(runtimeCategory.secretStatus.map((secret) => [secret.key, secret.value ?? ""])),
    );
  }, [runtimeCategory]);

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Runtime Files</span>
        <h1>文件与备份管理</h1>
        <p>这里管理开源复用时最关键的私有运行文件。替换、删除和恢复都会先保留可回滚版本。</p>
        <button className="admin-refresh-button" disabled={isBusy} onClick={() => void refresh()} type="button">
          <RefreshCw size={16} />
          {isBusy ? "处理中" : "刷新文件状态"}
        </button>
        <div className="admin-file-global-actions">
          <a className="admin-refresh-button" href={getRuntimeExportUrl()}>
            <Download size={16} />
            一键导出
          </a>
          <label className="admin-file-button">
            <FileUp size={16} />
            一键导入
            <input accept=".tar.gz,.tgz,application/gzip,application/x-gzip" disabled={isBusy} onChange={handleImportArchive} type="file" />
          </label>
        </div>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}
      {message ? <p className="admin-content-message">{message}</p> : null}

      {runtimeCategory ? (
        <section className="admin-control-panel admin-runtime-secret-panel reveal delay-1">
          <div className="admin-panel-title">
            <span>
              <ShieldCheck size={15} />
              Secrets
            </span>
            <h2>运行配置/密钥替换</h2>
          </div>
          <p className="admin-muted-copy">当前值允许在管理页明文查看和编辑。保存后需要重启服务才会生效。</p>
          <div className="admin-secret-status-grid">
            {runtimeCategory.secretStatus?.map((secret) => (
              <span className={secret.isConfigured ? "is-ready" : ""} key={secret.key}>
                {secret.key}: {secret.isConfigured ? "已配置" : "未配置"}
              </span>
            ))}
          </div>
          <div className="admin-editor-grid">
            {secretFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  disabled={isBusy}
                  onChange={(event) => setRuntimeForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder="未配置"
                  type="text"
                  value={runtimeForm[field.key] ?? ""}
                />
              </label>
            ))}
          </div>
          <div className="admin-editor-actions">
            <button className="primary-button" disabled={isBusy} onClick={() => void handleRuntimeSave()} type="button">
              <Save size={17} />
              保存运行配置
            </button>
          </div>
          <div className="admin-backup-list">
            <h3>运行配置历史版本</h3>
            {runtimeCategory.backups.length ? (
              runtimeCategory.backups.map((backup) => (
                <div className="admin-backup-row" key={backup.id}>
                  <span>
                    <strong>{backup.originalPath}</strong>
                    <em>{backup.action} · {formatDateTime(backup.createdAt)}</em>
                  </span>
                  <button disabled={isBusy} onClick={() => void handleRestore("runtime-settings", backup.id)} type="button">
                    <RotateCcw size={15} />
                    恢复
                  </button>
                </div>
              ))
            ) : (
              <p className="admin-empty-inline">还没有运行配置历史版本。</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="admin-content-grid admin-file-manager-grid reveal delay-1" aria-label="运行文件分类">
        {fileCategories.map((category) => (
          <ManagedCategoryCard
            category={category}
            disabled={isBusy}
            key={category.category}
            onDelete={(nextCategory, fileName) => void handleDelete(nextCategory, fileName)}
            onRestore={(nextCategory, id) => void handleRestore(nextCategory, id)}
            onUpload={(nextCategory, file, kind) => void handleUpload(nextCategory, file, kind)}
          />
        ))}
      </section>
      <p className="admin-muted-copy">文件状态生成于 {formatDateTime(dashboard.generatedAt)}。</p>
    </section>
  );
}

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Clock3, Compass, Eye, MapPin, RefreshCw, ShieldOff, TrendingUp, UserX, Wifi } from "lucide-react";
import {
  formatDateTime,
  formatDuration,
  getAdminSiteSettings,
  getVisitDashboard,
  kickVisitSession,
  updateAdminSiteSettings,
  type SiteSettings,
  type VisitDashboard,
} from "../../utils/adminAccess";
import {
  emptyDashboard,
  emptySettings,
  emptyVisitFilters,
  calculateVisitQualityStats,
  filterVisitsByTimeWindow,
  formatGeoTitle,
  formatPageName,
  formatPercent,
  getAverageDuration,
  getPageTone,
  getVisitRegionLabel,
  visitTimeWindowOptions,
  type VisitFilters,
  type VisitStatusFilter,
  type VisitTimeWindow,
} from "./adminUtils";

const VISITS_PER_PAGE = 100;

export default function AdminVisitsPage() {
  const [dashboard, setDashboard] = useState<VisitDashboard>(emptyDashboard);
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [error, setError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [visitActionMessage, setVisitActionMessage] = useState("");
  const [visitFilters, setVisitFilters] = useState<VisitFilters>(emptyVisitFilters);
  const [excludedVisitIpsText, setExcludedVisitIpsText] = useState(emptySettings.excludedVisitIps.join("\n"));
  const [visitPage, setVisitPage] = useState(1);
  const [kickingVisitId, setKickingVisitId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const windowedVisits = useMemo(
    () => filterVisitsByTimeWindow(dashboard.visits, visitFilters.timeWindow, dashboard.generatedAt),
    [dashboard.generatedAt, dashboard.visits, visitFilters.timeWindow],
  );
  const windowedActiveCount = useMemo(() => windowedVisits.filter((visit) => visit.isActive).length, [windowedVisits]);
  const recentVisits = useMemo(() => windowedVisits.slice(0, 80), [windowedVisits]);
  const pageFilterOptions = useMemo(
    () =>
      Array.from(new Set(dashboard.visits.map((visit) => visit.page)))
        .filter(Boolean)
        .sort((left, right) => formatPageName(left).localeCompare(formatPageName(right), "zh-CN")),
    [dashboard.visits],
  );
  const regionFilterOptions = useMemo(
    () => Array.from(new Set(dashboard.visits.map(getVisitRegionLabel))).filter(Boolean).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [dashboard.visits],
  );
  const qualityStats = useMemo(() => calculateVisitQualityStats(windowedVisits), [windowedVisits]);
  const pageOverview = useMemo(() => {
    const counts = new Map<string, { activeCount: number; durationMs: number; page: string; pageVisits: VisitDashboard["visits"]; visits: number }>();
    windowedVisits.forEach((visit) => {
      const current = counts.get(visit.page) ?? {
        activeCount: 0,
        durationMs: 0,
        page: visit.page,
        pageVisits: [],
        visits: 0,
      };
      current.visits += 1;
      current.durationMs += visit.durationMs;
      current.activeCount += visit.isActive ? 1 : 0;
      current.pageVisits.push(visit);
      counts.set(visit.page, current);
    });

    const items = Array.from(counts.values()).sort((left, right) => right.visits - left.visits);
    const maxVisits = Math.max(...items.map((item) => item.visits), 1);
    return items.map((item) => ({
      ...item,
      averageDurationMs: getAverageDuration(item.durationMs, item.visits),
      quality: calculateVisitQualityStats(item.pageVisits, { volumeScore: Math.round((item.visits / maxVisits) * 100) }),
      percentage: Math.max(7, Math.round((item.visits / maxVisits) * 100)),
    }));
  }, [windowedVisits]);
  const topPage = pageOverview[0];
  const regionOverview = useMemo(() => {
    const counts = new Map<string, number>();
    recentVisits.forEach((visit) => {
      const label = getVisitRegionLabel(visit);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    const items = Array.from(counts.entries())
      .map(([label, count]) => ({ count, label }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
    const maxCount = Math.max(...items.map((item) => item.count), 1);

    return items.map((item) => ({
      ...item,
      percentage: Math.max(8, Math.round((item.count / maxCount) * 100)),
    }));
  }, [recentVisits]);
  const filteredVisits = useMemo(() => {
    const query = visitFilters.ipQuery.trim().toLowerCase();

    return windowedVisits.filter((visit) => {
      if (visitFilters.page !== "all" && visit.page !== visitFilters.page) return false;
      if (visitFilters.status === "online" && !visit.isActive) return false;
      if (visitFilters.status === "offline" && visit.isActive) return false;
      if (visitFilters.region !== "all" && getVisitRegionLabel(visit) !== visitFilters.region) return false;

      if (!query) return true;

      const searchableText = [visit.ip, visit.page, formatPageName(visit.page), getVisitRegionLabel(visit), visit.geo?.summary, visit.userAgent]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchableText.includes(query);
    });
  }, [visitFilters, windowedVisits]);
  const visitTotalPages = Math.max(1, Math.ceil(filteredVisits.length / VISITS_PER_PAGE));
  const currentVisitPage = Math.min(visitPage, visitTotalPages);
  const pagedVisits = useMemo(() => {
    const startIndex = (currentVisitPage - 1) * VISITS_PER_PAGE;
    return filteredVisits.slice(startIndex, startIndex + VISITS_PER_PAGE);
  }, [currentVisitPage, filteredVisits]);
  const visitRangeStart = filteredVisits.length ? (currentVisitPage - 1) * VISITS_PER_PAGE + 1 : 0;
  const visitRangeEnd = filteredVisits.length ? visitRangeStart + pagedVisits.length - 1 : 0;
  const hasActiveVisitFilters =
    visitFilters.timeWindow !== "all" ||
    visitFilters.page !== "all" ||
    visitFilters.status !== "all" ||
    visitFilters.region !== "all" ||
    Boolean(visitFilters.ipQuery.trim());

  const refreshDashboard = async () => {
    setIsRefreshing(true);
    try {
      const [nextDashboard, nextSettings] = await Promise.all([getVisitDashboard(), getAdminSiteSettings()]);
      setDashboard(nextDashboard);
      setSettings(nextSettings);
      setExcludedVisitIpsText(nextSettings.excludedVisitIps.join("\n"));
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "访问统计读取失败。");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveExcludedVisitIps = async () => {
    const excludedVisitIps = Array.from(
      new Set(
        excludedVisitIpsText
          .split(/[\n,\uFF0C\s]+/)
          .map((ip) => ip.trim())
          .filter(Boolean),
      ),
    );

    setIsSavingSettings(true);
    setSettingsMessage("");
    try {
      const nextSettings = await updateAdminSiteSettings({ excludedVisitIps });
      setSettings(nextSettings);
      setExcludedVisitIpsText(nextSettings.excludedVisitIps.join("\n"));
      setSettingsMessage(nextSettings.excludedVisitIps.length ? "排除 IP 已保存，访问记录已刷新。" : "排除 IP 已清空，访问记录已刷新。");
      await refreshDashboard();
    } catch (saveError) {
      setSettingsMessage(saveError instanceof Error ? saveError.message : "排除 IP 保存失败。");
    } finally {
      setIsSavingSettings(false);
    }
  };

  useEffect(() => {
    void refreshDashboard();
    const intervalId = window.setInterval(() => {
      void refreshDashboard();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setVisitPage((current) => Math.min(current, visitTotalPages));
  }, [visitTotalPages]);

  const scrollToVisitList = () => {
    document.getElementById("admin-visit-list")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const updateVisitFilters = (nextFilters: Partial<VisitFilters>) => {
    setVisitFilters((current) => ({
      ...current,
      ...nextFilters,
    }));
    setVisitPage(1);
  };

  const clearVisitFilters = () => {
    setVisitFilters(emptyVisitFilters);
    setVisitPage(1);
  };

  const handlePageOverviewClick = (page: string) => {
    updateVisitFilters({ page });
    window.setTimeout(scrollToVisitList, 0);
  };

  const handleKickVisit = async (visit: VisitDashboard["visits"][number]) => {
    if (!visit.isActive || visit.kickedAt) return;

    const confirmed = window.confirm(`确定强制结束这个访问会话吗？\nIP：${visit.ip}\n页面：${formatPageName(visit.page)}`);
    if (!confirmed) return;

    setKickingVisitId(visit.id);
    setVisitActionMessage("");
    try {
      await kickVisitSession(visit.id);
      setVisitActionMessage(`已踢出 ${visit.ip} 的当前访问会话。`);
      await refreshDashboard();
    } catch (kickError) {
      setVisitActionMessage(kickError instanceof Error ? kickError.message : "踢出访问会话失败。");
    } finally {
      setKickingVisitId(null);
    }
  };

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Visitor Intelligence</span>
        <h1>访问记录</h1>
        <p>集中查看访客来自哪里、正在看什么、停留多久。页面排行榜可点击后直接筛选对应访问记录。</p>
        <button className="admin-refresh-button" disabled={isRefreshing} onClick={() => void refreshDashboard()} type="button">
          <RefreshCw size={16} />
          {isRefreshing ? "刷新中" : "刷新访问数据"}
        </button>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      <section className="admin-metrics reveal delay-1" aria-label="访问概览">
        <article>
          <Eye size={18} />
          <span>窗口访问</span>
          <strong>{windowedVisits.length}</strong>
        </article>
        <article>
          <Wifi size={18} />
          <span>当前在线</span>
          <strong>{windowedActiveCount}</strong>
        </article>
        <article>
          <Clock3 size={18} />
          <span>平均停留</span>
          <strong>{formatDuration(qualityStats.trimmedAverageDurationMs)}</strong>
        </article>
        <article>
          <TrendingUp size={18} />
          <span>访问质量分</span>
          <strong>{qualityStats.qualityScore}</strong>
        </article>
      </section>

      <section className="admin-quality-panel reveal delay-1" aria-label="访问质量分析">
        <div className="admin-panel-title">
          <span>
            <Activity size={15} />
            Quality Analytics
          </span>
          <h2>访问质量分析</h2>
        </div>
        <div className="admin-quality-grid">
          <article>
            <span>截尾平均</span>
            <strong>{formatDuration(qualityStats.trimmedAverageDurationMs)}</strong>
            <p>去掉最短和最长 5% 的极端访问后再计算，更接近真实停留水平。</p>
          </article>
          <article>
            <span>中位数</span>
            <strong>{formatDuration(qualityStats.medianDurationMs)}</strong>
            <p>代表普通访客的停留时间，不容易被挂机或误点带偏。</p>
          </article>
          <article>
            <span>有效访问率</span>
            <strong>{formatPercent(qualityStats.effectiveVisitRate)}</strong>
            <p>停留超过 10 秒的访问占比，用来判断页面是否真的被看了。</p>
          </article>
          <article>
            <span>快速离开率</span>
            <strong>{formatPercent(qualityStats.quickExitRate)}</strong>
            <p>停留少于 5 秒的访问占比，越低说明首屏承接越稳定。</p>
          </article>
          <article>
            <span>深度访问率</span>
            <strong>{formatPercent(qualityStats.deepVisitRate)}</strong>
            <p>停留超过 60 秒的访问占比，用来观察认真阅读或深度探索。</p>
          </article>
          <article>
            <span>样本可信度</span>
            <strong>{qualityStats.reliabilityLabel}</strong>
            <p>当前样本 {qualityStats.sampleSize} 条，样本越多，页面质量判断越可靠。</p>
          </article>
        </div>
      </section>

      <section className="admin-visit-settings-panel reveal delay-1" aria-label="访问统计设置">
        <div className="admin-panel-title">
          <span>
            <ShieldOff size={15} />
            Visit Settings
          </span>
          <h2>排除 IP</h2>
        </div>
        <p>这些 IP 的访问不会写入访问记录，保存后也会从当前访问列表中清理。每行一个 IP，适合排除自己的服务器、办公网络或测试设备。</p>
        <textarea
          disabled={isSavingSettings}
          onChange={(event) => setExcludedVisitIpsText(event.target.value)}
          placeholder="127.0.0.1"
          rows={Math.max(3, Math.min(8, settings.excludedVisitIps.length + 2))}
          value={excludedVisitIpsText}
        />
        <div className="admin-visit-settings-actions">
          <span>{settings.excludedVisitIps.length} 个 IP 已排除</span>
          <button className="admin-refresh-button" disabled={isSavingSettings} onClick={() => void handleSaveExcludedVisitIps()} type="button">
            <ShieldOff size={16} />
            {isSavingSettings ? "保存中" : "保存排除 IP"}
          </button>
        </div>
        {settingsMessage ? <p className="admin-content-message">{settingsMessage}</p> : null}
      </section>

      <section className="admin-chart-panel reveal delay-1" aria-label="页面访问图表">
        <div className="admin-chart-summary">
          <span>
            <BarChart3 size={16} />
            页面访问
          </span>
          <strong>{topPage ? formatPageName(topPage.page) : "暂无访问"}</strong>
          <p>{topPage ? `当前访问最多的页面，共 ${topPage.visits} 次访问。` : "有访问记录后，这里会显示各页面热度。"}</p>
        </div>
        <div className="admin-page-bars">
          {pageOverview.length ? (
            pageOverview.map((page) => (
              <button
                className={`admin-page-bar-card${visitFilters.page === page.page ? " admin-page-bar-card-active" : ""}`}
                key={page.page}
                onClick={() => handlePageOverviewClick(page.page)}
                type="button"
              >
                <div className="admin-page-bar-head">
                  <span>
                    <b className={`page-chip page-chip-${getPageTone(page.page)}`}>{formatPageName(page.page)}</b>
                    {page.activeCount ? <em>{page.activeCount} 人在线</em> : null}
                  </span>
                  <strong>{page.quality.qualityScore} 分</strong>
                </div>
                <div className="admin-page-bar-track">
                  <i style={{ "--page-width": `${Math.max(7, page.quality.qualityScore)}%` } as CSSProperties} />
                </div>
                <p>
                  {page.visits} 次 · 截尾 {formatDuration(page.quality.trimmedAverageDurationMs)} · 中位 {formatDuration(page.quality.medianDurationMs)} · 有效{" "}
                  {formatPercent(page.quality.effectiveVisitRate)}
                </p>
              </button>
            ))
          ) : (
            <p className="admin-empty-inline">暂时还没有页面访问数据。</p>
          )}
        </div>
      </section>

      <section className="admin-region-panel reveal delay-1" aria-label="访问来源分布">
        <div className="admin-region-head">
          <span>
            <Compass size={16} />
            来源分布
          </span>
          <strong>{regionOverview[0]?.label ?? "暂无来源"}</strong>
        </div>
        <div className="admin-region-list">
          {regionOverview.length ? (
            regionOverview.map((region) => (
              <article key={region.label}>
                <div>
                  <span>{region.label}</span>
                  <strong>{region.count} 次</strong>
                </div>
                <em style={{ "--region-width": `${region.percentage}%` } as CSSProperties} />
              </article>
            ))
          ) : (
            <p>暂无可分析的访问来源。</p>
          )}
        </div>
      </section>

      <section className="admin-table-shell" id="admin-visit-list">
        <div className="admin-table-head">
          <div>
            <span>Visitor Sessions</span>
            <h2>访问记录</h2>
          </div>
          <strong>
            {filteredVisits.length} / {windowedVisits.length} 条
          </strong>
        </div>
        <div className="admin-visit-filters" aria-label="访问记录筛选">
          <label>
            时间
            <select value={visitFilters.timeWindow} onChange={(event) => updateVisitFilters({ timeWindow: event.target.value as VisitTimeWindow })}>
              {visitTimeWindowOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            页面
            <select value={visitFilters.page} onChange={(event) => updateVisitFilters({ page: event.target.value })}>
              <option value="all">全部页面</option>
              {pageFilterOptions.map((page) => (
                <option key={page} value={page}>
                  {formatPageName(page)}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={visitFilters.status} onChange={(event) => updateVisitFilters({ status: event.target.value as VisitStatusFilter })}>
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="offline">离开</option>
            </select>
          </label>
          <label>
            地区
            <select value={visitFilters.region} onChange={(event) => updateVisitFilters({ region: event.target.value })}>
              <option value="all">全部地区</option>
              {regionFilterOptions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>
          <label>
            IP / 关键词
            <input
              onChange={(event) => updateVisitFilters({ ipQuery: event.target.value })}
              placeholder="搜索 IP、页面、地区或设备"
              value={visitFilters.ipQuery}
            />
          </label>
          <button disabled={!hasActiveVisitFilters} onClick={clearVisitFilters} type="button">
            清除筛选
          </button>
        </div>
        {visitActionMessage ? <p className="admin-visit-action-message">{visitActionMessage}</p> : null}
        <div className="admin-table">
          <div className="admin-table-row admin-table-header">
            <span>状态</span>
            <span>IP</span>
            <span>地址分析</span>
            <span>页面</span>
            <span>进入时间</span>
            <span>最后活跃</span>
            <span>停留</span>
            <span>操作</span>
          </div>
          {pagedVisits.length ? (
            pagedVisits.map((visit) => (
              <article className={`admin-table-row${visit.isActive ? " admin-table-row-online" : ""}${visit.kickedAt ? " admin-table-row-kicked" : ""}`} key={visit.id}>
                <span>
                  <i className={visit.isActive ? "is-online" : ""} />
                  {visit.kickedAt ? "已踢出" : visit.isActive ? "在线" : "离开"}
                </span>
                <span title={visit.ip}>
                  <MapPin size={14} />
                  {visit.ip}
                </span>
                <span title={formatGeoTitle(visit)}>
                  <small className={`geo-dot geo-dot-${visit.geo?.status ?? "miss"}`} />
                  {visit.geo?.summary ?? "等待地址解析"}
                </span>
                <span title={visit.page}>
                  <b className={`page-chip page-chip-${getPageTone(visit.page)}`}>{formatPageName(visit.page)}</b>
                </span>
                <span>{formatDateTime(visit.startedAt)}</span>
                <span>{formatDateTime(visit.lastSeenAt)}</span>
                <span>{formatDuration(visit.durationMs)}</span>
                <span>
                  {visit.kickedAt ? (
                    <small className="admin-kick-note">{formatDateTime(visit.kickedAt)}</small>
                  ) : (
                    <button
                      className="admin-kick-button"
                      disabled={!visit.isActive || kickingVisitId === visit.id}
                      onClick={() => void handleKickVisit(visit)}
                      type="button"
                    >
                      <UserX size={14} />
                      {kickingVisitId === visit.id ? "处理中" : "踢下线"}
                    </button>
                  )}
                </span>
              </article>
            ))
          ) : (
            <div className="admin-empty">{dashboard.totalVisits ? "当前筛选下没有访问记录。" : "暂时还没有访问记录。"}</div>
          )}
        </div>
        <div className="admin-pagination" aria-label="访问记录分页">
          <span>
            每页 {VISITS_PER_PAGE} 条 · 当前显示 {visitRangeStart}-{visitRangeEnd} · 全部记录 {dashboard.totalVisits} 条
          </span>
          <div>
            <button disabled={currentVisitPage <= 1} onClick={() => setVisitPage((current) => Math.max(1, current - 1))} type="button">
              上一页
            </button>
            <strong>
              {currentVisitPage} / {visitTotalPages}
            </strong>
            <button disabled={currentVisitPage >= visitTotalPages} onClick={() => setVisitPage((current) => Math.min(visitTotalPages, current + 1))} type="button">
              下一页
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
